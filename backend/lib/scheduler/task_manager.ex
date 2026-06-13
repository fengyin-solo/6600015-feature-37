defmodule Scheduler.TaskManager do
  use GenServer

  defmodule Task do
    defstruct [:id, :name, :status, :node, :created_at, :retries, :max_retries, :logs, :node_assigned_by, :preferred_node]
  end

  @worker_count 4

  # Client API
  def start_link(_opts) do
    GenServer.start_link(__MODULE__, %{}, name: __MODULE__)
  end

  def list_tasks, do: GenServer.call(__MODULE__, :list_tasks)

  def add_task(name, preferred_node \\ nil) do
    GenServer.call(__MODULE__, {:add_task, name, preferred_node})
  end

  def retry_task(id), do: GenServer.call(__MODULE__, {:retry_task, id})

  def cancel_task(id), do: GenServer.call(__MODULE__, {:cancel_task, id})

  def get_stats, do: GenServer.call(__MODULE__, :get_stats)

  def list_nodes, do: GenServer.call(__MODULE__, :list_nodes)

  # Server callbacks
  @impl true
  def init(_) do
    nodes = generate_nodes()
    worker_names = for n <- nodes, n.type == "worker", do: n.name

    tasks = for i <- 1..8 do
      name = Enum.at(~w[data_sync email_batch report_gen cache_warm log_rotate db_backup index_rebuild health_check], rem(i - 1, 8))
      status = Enum.at(~w[pending running success failed]a, :rand.uniform(4) - 1)
      %Task{
        id: "task-#{1000 + i}",
        name: name,
        status: status,
        node: Enum.random(worker_names),
        created_at: DateTime.utc_now(),
        retries: 0,
        max_retries: 3,
        logs: ["[INFO] Task #{name} created"],
        node_assigned_by: :random,
        preferred_node: nil
      }
    end
    {:ok, %{tasks: tasks, counter: 1009, nodes: nodes}}
  end

  defp generate_nodes do
    scheduler = %{
      id: "node-1",
      name: "scheduler-main",
      type: "scheduler",
      status: "online",
      cpu: 15 + :rand.uniform() * 25,
      memory: 25 + :rand.uniform() * 30,
      tasks: 0,
      uptime: 3600 + :rand.uniform(86400)
    }

    workers = for i <- 1..@worker_count do
      status = if :rand.uniform() > 0.15, do: "online", else: "overloaded"
      %{
        id: "node-#{i + 1}",
        name: "worker-#{i}",
        type: "worker",
        status: status,
        cpu: 20 + :rand.uniform() * 60,
        memory: 30 + :rand.uniform() * 50,
        tasks: :rand.uniform(5),
        uptime: 3600 + :rand.uniform(86400)
      }
    end

    [scheduler | workers]
  end

  defp worker_nodes_names(nodes) do
    nodes |> Enum.filter(& &1.type == "worker") |> Enum.map(& &1.name)
  end

  @impl true
  def handle_call(:list_tasks, _from, state) do
    {:reply, state.tasks, state}
  end

  @impl true
  def handle_call(:list_nodes, _from, state) do
    updated_nodes = Enum.map(state.nodes, fn node ->
      if node.type == "worker" do
        task_count = Enum.count(state.tasks, fn t -> t.node == node.name and t.status in [:pending, :running] end)
        %{node | tasks: task_count}
      else
        node
      end
    end)
    {:reply, updated_nodes, %{state | nodes: updated_nodes}}
  end

  defp node_suitable?(node_name, state) do
    workers = worker_nodes_names(state.nodes)

    cond do
      not (node_name in workers) ->
        false

      true ->
        node = Enum.find(state.nodes, & &1.name == node_name)
        running_count = Enum.count(state.tasks, fn t -> t.node == node_name and t.status in [:pending, :running] end)
        overload? = node && node.status == "overloaded"
        not overload? and running_count < 6
    end
  end

  defp assign_node(nil, state) do
    workers = worker_nodes_names(state.nodes)
    suitable = Enum.filter(workers, &node_suitable?(&1, state))
    chosen = if length(suitable) > 0, do: Enum.random(suitable), else: Enum.random(workers)
    {chosen, :random, [], nil}
  end

  defp assign_node(preferred_node, state) do
    preferred_node = to_string(preferred_node)
    workers = worker_nodes_names(state.nodes)

    cond do
      preferred_node in workers and node_suitable?(preferred_node, state) ->
        {preferred_node, :preferred, ["[INFO] 优先分配到指定节点 #{preferred_node}"], preferred_node}

      preferred_node in workers ->
        suitable_candidates = Enum.filter(workers, &node_suitable?(&1, state))
        fallback = if length(suitable_candidates) > 0, do: Enum.random(suitable_candidates), else: Enum.random(workers)
        reason = if Enum.find(state.nodes, & &1.name == preferred_node && &1.status == "overloaded"),
          do: "节点过载", else: "任务队列已满"
        {fallback, :fallback, [
          "[WARN] 首选节点 #{preferred_node} 不可用（#{reason}）",
          "[INFO] 自动回退到节点 #{fallback}"
        ], preferred_node}

      true ->
        suitable = Enum.filter(workers, &node_suitable?(&1, state))
        fallback = if length(suitable) > 0, do: Enum.random(suitable), else: Enum.random(workers)
        {fallback, :fallback, [
          "[WARN] 指定节点 \"#{preferred_node}\" 无效",
          "[INFO] 自动回退到节点 #{fallback}"
        ], preferred_node}
    end
  end

  @impl true
  def handle_call({:add_task, name, preferred_node}, _from, state) do
    counter = state.counter + 1
    {assigned_node, assigned_by, extra_logs, pref_node} = assign_node(preferred_node, state)

    task = %Task{
      id: "task-#{counter}",
      name: name,
      status: :pending,
      node: assigned_node,
      created_at: DateTime.utc_now(),
      retries: 0,
      max_retries: 3,
      logs: ["[INFO] Task #{name} queued"] ++ extra_logs,
      node_assigned_by: assigned_by,
      preferred_node: pref_node
    }
    {:reply, task, %{state | tasks: [task | state.tasks], counter: counter}}
  end

  @impl true
  def handle_call({:retry_task, id}, _from, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id} = t -> %{t | status: :pending, retries: t.retries + 1, logs: t.logs ++ ["[INFO] Retrying..."]}
      t -> t
    end)
    {:reply, :ok, %{state | tasks: tasks}}
  end

  @impl true
  def handle_call({:cancel_task, id}, _from, state) do
    tasks = Enum.map(state.tasks, fn
      %{id: ^id} = t -> %{t | status: :failed, logs: t.logs ++ ["[WARN] Cancelled"]}
      t -> t
    end)
    {:reply, :ok, %{state | tasks: tasks}}
  end

  @impl true
  def handle_call(:get_stats, _from, state) do
    stats = %{
      total: length(state.tasks),
      running: Enum.count(state.tasks, & &1.status == :running),
      success: Enum.count(state.tasks, & &1.status == :success),
      failed: Enum.count(state.tasks, & &1.status == :failed)
    }
    {:reply, stats, state}
  end
end
