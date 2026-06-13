defmodule Scheduler.TaskManager do
  use GenServer

  defmodule Task do
    defstruct [:id, :name, :status, :node, :created_at, :retries, :max_retries, :logs, :node_assigned_by]
  end

  @worker_nodes for i <- 1..4, do: "worker-#{i}"

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
    tasks = for i <- 1..8 do
      name = Enum.at(~w[data_sync email_batch report_gen cache_warm log_rotate db_backup index_rebuild health_check], rem(i - 1, 8))
      status = Enum.at(~w[pending running success failed]a, :rand.uniform(4) - 1)
      %Task{
        id: "task-#{1000 + i}",
        name: name,
        status: status,
        node: "worker-#{:rand.uniform(4)}",
        created_at: DateTime.utc_now(),
        retries: 0,
        max_retries: 3,
        logs: ["[INFO] Task #{name} created"],
        node_assigned_by: :random
      }
    end
    {:ok, %{tasks: tasks, counter: 1009}}
  end

  @impl true
  def handle_call(:list_tasks, _from, state) do
    {:reply, state.tasks, state}
  end

  @impl true
  def handle_call(:list_nodes, _from, state) do
    nodes = for i <- 1..5 do
      %{
        id: "node-#{i}",
        name: if(i == 1, do: "scheduler-main", else: "worker-#{i - 1}"),
        type: if(i == 1, do: "scheduler", else: "worker"),
        status: if(:rand.uniform() > 0.1, do: "online", else: "overloaded"),
        cpu: 20 + :rand.uniform() * 60,
        memory: 30 + :rand.uniform() * 50,
        tasks: :rand.uniform(8),
        uptime: 3600 + :rand.uniform(86400)
      }
    end
    {:reply, nodes, state}
  end

  defp node_suitable?(node_name, state) do
    cond do
      not (node_name in @worker_nodes) ->
        false

      true ->
        running_count =
          state.tasks
          |> Enum.count(fn t -> t.node == node_name and t.status in [:pending, :running] end)
        running_count < 6
    end
  end

  defp assign_node(nil, state) do
    {Enum.random(@worker_nodes), :random, []}
  end

  defp assign_node(preferred_node, state) do
    preferred_node = to_string(preferred_node)

    cond do
      preferred_node in @worker_nodes and node_suitable?(preferred_node, state) ->
        {preferred_node, :preferred, ["[INFO] Assigned to preferred node #{preferred_node}"]}

      preferred_node in @worker_nodes ->
        fallback =
          @worker_nodes
          |> Enum.filter(&node_suitable?(&1, state))
          |> case do
            [] -> Enum.random(@worker_nodes)
            candidates -> Enum.random(candidates)
          end
        {fallback, :fallback, ["[WARN] Preferred node #{preferred_node} unsuitable, fell back to #{fallback}"]}

      true ->
        {Enum.random(@worker_nodes), :random, ["[WARN] Preferred node #{preferred_node} invalid, random assignment"]}
    end
  end

  @impl true
  def handle_call({:add_task, name, preferred_node}, _from, state) do
    counter = state.counter + 1
    {assigned_node, assigned_by, extra_logs} = assign_node(preferred_node, state)

    task = %Task{
      id: "task-#{counter}",
      name: name,
      status: :pending,
      node: assigned_node,
      created_at: DateTime.utc_now(),
      retries: 0,
      max_retries: 3,
      logs: ["[INFO] Task #{name} queued"] ++ extra_logs,
      node_assigned_by: assigned_by
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
