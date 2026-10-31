#!/bin/zsh
# The default executes on the active tab's connected account, including live accounts.
set -eu
task_root="${0:A:h:h}"
task_node="${TV_ORDER_NODE:-}"
if [[ -z "$task_node" ]]; then
  task_node="$(command -v node || true)"
fi
if [[ -z "$task_node" ]]; then
  task_nodes=("$HOME"/.nvm/versions/node/*/bin/node(Nom))
  task_node="${task_nodes[1]:-}"
fi
if [[ ! -x "$task_node" ]]; then
  print -u2 'Node.js was not found. Install Node.js or set TV_ORDER_NODE to its executable path.'
  exit 1
fi
if (( $# == 0 )); then
  set -- --connected
fi
print 'TradingView order shortcuts: orders go to the connected account. Live accounts use real money.'
exec "$task_node" "$task_root/scripts/order-buttons.mjs" serve "$@"
