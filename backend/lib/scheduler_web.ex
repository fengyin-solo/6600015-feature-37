defmodule SchedulerWeb.CORS do
  import Plug.Conn

  @origins ["http://localhost:5173", "http://localhost:3000", "http://localhost:8080", "http://127.0.0.1:5173", "http://127.0.0.1:3000"]

  def init(opts), do: opts

  def call(conn, _opts) do
    origin = get_req_header(conn, "origin") |> List.first()

    if origin in @origins do
      conn
      |> put_resp_header("access-control-allow-origin", origin)
      |> put_resp_header("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS")
      |> put_resp_header("access-control-allow-headers", "Content-Type, Authorization")
      |> put_resp_header("access-control-allow-credentials", "true")
      |> handle_preflight()
    else
      conn
    end
  end

  defp handle_preflight(%{method: "OPTIONS"} = conn) do
    conn
    |> put_resp_content_type("text/plain")
    |> send_resp(204, "")
    |> halt()
  end

  defp handle_preflight(conn), do: conn
end

defmodule SchedulerWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :scheduler

  plug SchedulerWeb.CORS
  plug Plug.Static, at: "/", from: :scheduler, gzip: false
  plug Plug.Parsers, parsers: [:json], pass: [], json_decoder: Jason
  plug SchedulerWeb.Router
end

defmodule SchedulerWeb.Router do
  use Phoenix.Router
  import Phoenix.Controller

  pipeline :api do
    plug :accepts, ["json"]
  end

  scope "/api", SchedulerWeb do
    pipe_through :api
    get "/tasks", TaskController, :index
    post "/tasks", TaskController, :create
    post "/tasks/:id/retry", TaskController, :retry
    post "/tasks/:id/cancel", TaskController, :cancel
    get "/stats", TaskController, :stats
    get "/nodes", TaskController, :nodes
  end
end

defmodule SchedulerWeb.TaskController do
  use Phoenix.Controller, formats: [:json]

  def index(conn, _params) do
    tasks = Scheduler.TaskManager.list_tasks()
    json(conn, %{tasks: Enum.map(tasks, &Map.from_struct/1)})
  end

  def create(conn, %{"name" => name} = params) do
    preferred_node = Map.get(params, "preferred_node")
    task = Scheduler.TaskManager.add_task(name, preferred_node)
    json(conn, %{task: Map.from_struct(task)})
  end

  def retry(conn, %{"id" => id}) do
    Scheduler.TaskManager.retry_task(id)
    json(conn, %{status: "ok"})
  end

  def cancel(conn, %{"id" => id}) do
    Scheduler.TaskManager.cancel_task(id)
    json(conn, %{status: "ok"})
  end

  def stats(conn, _params) do
    json(conn, Scheduler.TaskManager.get_stats())
  end

  def nodes(conn, _params) do
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
    json(conn, %{nodes: nodes})
  end
end

defmodule SchedulerWeb.ErrorJSON do
  def render(template, _assigns) do
    %{errors: %{detail: Phoenix.Controller.status_message_from_template(template)}}
  end
end
