defmodule Scheduler.Application do
  use Application

  @impl true
  def start(_type, _args) do
    children = [
      Scheduler.TaskManager,
      {Phoenix.PubSub, name: Scheduler.PubSub},
      SchedulerWeb.Endpoint
    ]

    opts = [strategy: :one_for_one, name: Scheduler.Supervisor]
    Supervisor.start_link(children, opts)
  end
end
