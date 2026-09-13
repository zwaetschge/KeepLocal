#!/bin/sh
# supervisord-Eventlistener: Container beenden, sobald ein Programm FATAL ist.
#
# Warum (Audit 2026-09-12, Top-30 Nr. 25): Ohne diesen Listener startet
# supervisord ein crashendes Programm endlos neu, und ein FATAL-Prozess ändert
# am Container-Status nichts — `docker ps` meldet weiter „Up", während z. B. der
# API-Prozess tot ist. Der Healthcheck schlägt zwar fehl, aber der Container
# bleibt „Up (unhealthy)" und niemand sieht den Grund, ohne `docker exec`
# (das genau dann nicht geht, wenn der Container neu startet).
#
# Mit dem Listener beendet sich der Container selbst. Die Restart-Policy startet
# ihn neu (Docker verdoppelt die Wartezeit bei jedem Fehlschlag), `docker ps`
# zeigt „Restarting", und `docker logs` enthält die Zeile mit dem Programmnamen.
#
# Protokoll: supervisord erwartet "READY" auf stdout, schickt dann
# Ereignis-Kopfzeilen; die Antwort ist "RESULT 2\nOK". Zum Beenden reicht ein
# SIGTERM an PID 1 (supervisord fährt alles geordnet herunter).

# Test-Seam: `kill` ist in sh ein Builtin, deshalb ist das Kommando hier
# überlagerbar — die Tests prüfen damit, dass der Listener PID 1 beendet, ohne
# wirklich etwas zu signalisieren. Im Image ist der Default (`kill`) aktiv.
KILL_COMMAND="${KEEPLOCAL_KILL_COMMAND:-kill}"

echo "READY"

while read -r header; do
  case "$header" in
    *eventname:PROCESS_STATE_FATAL*)
      # Payload lesen, damit supervisord nicht auf eine halbe Antwort wartet.
      length=$(printf '%s' "$header" | sed -n 's/.*len:\([0-9]*\).*/\1/p')
      payload=""
      if [ -n "$length" ] && [ "$length" -gt 0 ] 2>/dev/null; then
        payload=$(dd bs=1 count="$length" 2>/dev/null)
      fi
      echo "RESULT 2"
      echo "OK"
      echo "keeplocal: ein überwachtes Programm ist FATAL — Container wird beendet." >&2
      echo "keeplocal: Ereignis: $payload" >&2
      $KILL_COMMAND -TERM 1
      exit 0
      ;;
  esac
  echo "READY"
done
