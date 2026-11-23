#!/bin/sh
# Every iPad scene (landscape), in both themes. The iPad must have been turned to landscape in the Simulator first.
cd "$(dirname "$0")"
export OUT=../captures/ipad ROT=270
for T in light dark; do
  export THEME=$T
  ./sim-shot.sh ipad-history "section=history" 9
  ./sim-shot.sh ipad-directory "section=contacts" 10
  ./sim-shot.sh ipad-recordings "section=recordings" 9
  ./sim-shot.sh ipad-accounts "section=settings&tab=SIP accounts" 10
  ./sim-shot.sh ipad-general "section=settings&tab=General" 10
  ./sim-shot.sh ipad-contact "section=contacts&open=contact" 11
  ./sim-shot.sh ipad-call "scene=call" 15
  ./sim-shot.sh ipad-stats "scene=stats" 24
done
