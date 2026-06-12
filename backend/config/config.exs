import Config

config :scheduler, SchedulerWeb.Endpoint,
  http: [port: 4000],
  secret_key_base: "supersecretkey_change_in_production_at_least_64bytes_long_random_string_here",
  url: [host: "localhost"],
  render_errors: [formats: [json: SchedulerWeb.ErrorJSON]],
  check_origin: false

config :logger, level: :info
config :phoenix, :json_library, Jason

import_config "#{config_env()}.exs"
