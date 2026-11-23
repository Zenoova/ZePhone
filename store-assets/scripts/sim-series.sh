#!/bin/sh
# Every iPhone scene of the store pictures, in both themes (see sim-shot.sh).
cd "$(dirname "$0")"
for T in light dark; do
  export THEME=$T
  ./sim-shot.sh ios-dialer "" 8
  ./sim-shot.sh ios-directory "section=contacts" 9
  ./sim-shot.sh ios-history "section=history" 8
  ./sim-shot.sh ios-recordings "section=recordings" 8
  ./sim-shot.sh ios-accounts "section=settings&tab=SIP accounts" 9
  ./sim-shot.sh ios-general "section=settings&tab=General" 9
  ./sim-shot.sh ios-contact "section=contacts&open=contact" 10
  ./sim-shot.sh ios-popover "open=account" 9
  ./sim-shot.sh ios-incoming "scene=incoming" 9
  ./sim-shot.sh ios-call "scene=call" 15
  ./sim-shot.sh ios-stats "scene=stats" 24
done
