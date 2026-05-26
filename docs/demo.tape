# agentwatch README hero — VHS terminal recording.
# Generate with: vhs docs/demo.tape   →   writes docs/demo.gif
# vhs: https://github.com/charmbracelet/vhs   (brew install vhs)
#
# Recorded against the synthetic mock HOME (docs/demo-mock/setup.py builds
# /tmp/agentwatch-demo) so no real session data is ever captured. Rebuild
# the mock first:  python3 docs/demo-mock/setup.py

Output docs/demo.gif

Set FontSize 14
Set Width 1280
Set Height 760
Set Padding 24
Set Theme "Dracula"

Env HOME "/tmp/agentwatch-demo"
Env WORKSPACE_ROOT "/tmp/agentwatch-demo/workspace"
Env AGENTWATCH_PORT "4655"

Hide
Type "export PATH=/opt/homebrew/bin:$PATH && clear"
Enter
Show

Type "agentwatch doctor"
Sleep 700ms
Enter
Sleep 3s

Type "agentwatch"
Sleep 700ms
Enter
Sleep 5s
Type "?"
Sleep 3s
Escape
Sleep 1500ms
Type "q"
Sleep 1s
