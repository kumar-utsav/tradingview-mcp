#!/bin/zsh
# Compatibility path used by the existing Stream Deck button; Replay only.
set -eu
task_root="${0:A:h}"
exec "$task_root/Start TradingView Order Buttons.command" --replay
