import subprocess
import threading
import queue
import time
import re
import os
import sys
from typing import Optional

ELECTRON_PATH = r"D:/Electron/src/out/Release/electron.exe"
COMMAND = [
    ELECTRON_PATH,
    "--no-sandbox",
    "--enable-blink-features=CanvasHDR",
    "./dist/main.js",
]

LOG_FILTER_SUBSTR = "importSharedTexture"  # only consider lines with this
THRESHOLD = 300
CHECK_SECONDS = 15.0
SLEEP_BETWEEN_RUNS = 0.5  # small pause between cycles
4 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnn555555555555555555g555555555555555g5g5g5g5g5ggrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr
def _reader(stream, q: queue.Queue) -> None:
    try:
        for line in iter(stream.readline, ""):
            if not line:
                break
            q.put(line)
    except Exception:
        pass
    finally:
        try:
            stream.close()
        except Exception:
            pass

def _extract_last_number(line: str) -> Optional[int]:
    if LOG_FILTER_SUBSTR not in line:
        return None
    matches = re.findall(r"(\d+)", line)
    if not matches:
        return None
    try:
        return int(matches[-1])
    except ValueError:
        return None

def main() -> None:
    print("Starting infinite runner. Press Ctrl+C to stop.", flush=True)
    gt_count = 0
    lt_count = 0
    while True:
        try:
            proc = subprocess.Popen(
                COMMAND,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="ignore",
                cwd=os.getcwd(),
                shell=False,
            )
        except FileNotFoundError:
            print(f"Executable not found: {ELECTRON_PATH}", file=sys.stderr, flush=True)
            sys.exit(1)
        except Exception as e:
            print(f"Failed to start process: {e}", file=sys.stderr, flush=True)
            sys.exit(1)

        q: queue.Queue[str] = queue.Queue()
        t = threading.Thread(target=_reader, args=(proc.stdout, q), daemon=True)
        t.start()

        deadline = time.monotonic() + CHECK_SECONDS
        last_number: Optional[int] = None
        last_line: Optional[str] = None

        try:
            while time.monotonic() < deadline:
                try:
                    line = q.get(timeout=0.1)
                except queue.Empty:
                    # check if process has died; if so, drain quickly then break
                    if proc.poll() is not None:
                        # process exited; try to drain any remaining lines briefly
                        drain_until = time.monotonic() + 0.2
                        while time.monotonic() < drain_until:
                            try:
                                line = q.get_nowait()
                            except queue.Empty:
                                break
                            num = _extract_last_number(line)
                            if num is not None:
                                last_number = num
                                last_line = line.rstrip()
                        break
                    continue

                num = _extract_last_number(line)
                if num is not None:
                    last_number = num
                    last_line = line.rstrip()
        finally:
            # Try to terminate the process cleanly after the check window
            try:
                if proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=2.0)
                    except subprocess.TimeoutExpired:
                        proc.kill()
            except Exception:
                pass

        if last_number is None:
            print(
                f"[result] No matching log within {CHECK_SECONDS}s window. | gt={gt_count} lt={lt_count}",
                flush=True,
            )
        else:
            ok = last_number > THRESHOLD
            if last_number > THRESHOLD:
                gt_count += 1
            elif last_number < THRESHOLD:
                lt_count += 1
            print(
                f"[result] last_number={last_number} (> {THRESHOLD}: {ok}) | gt={gt_count} lt={lt_count}"
                + (f" | line: {last_line}" if last_line else ""),
                flush=True,
            )

        time.sleep(SLEEP_BETWEEN_RUNS)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nStopped.", flush=True)