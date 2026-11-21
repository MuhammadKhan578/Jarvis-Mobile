"""QA helper: evaluate Jarvis WebView checks over the debug CDP port.

Run after: adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
Only useful on a debug build; the final release APK is non-debuggable.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request

import websocket

PAGES_URL = "http://127.0.0.1:9222/json"


def evaluate(expression: str, timeout: int = 45, attempts: int = 3):
    """Evaluate one expression on a fresh socket so a timeout cannot desync it."""
    last_error = None
    for _ in range(attempts):
        try:
            pages = json.load(urllib.request.urlopen(PAGES_URL, timeout=8))
            page = next((p for p in pages if p.get("type") == "page" and
                         p.get("url", "").endswith("index.html")), None)
            if not page:
                raise RuntimeError("Jarvis WebView page not found")
            ws = websocket.create_connection(page["webSocketDebuggerUrl"],
                                             timeout=timeout, suppress_origin=True)
            try:
                ws.send(json.dumps({
                    "id": 1,
                    "method": "Runtime.evaluate",
                    "params": {
                        "expression": expression,
                        "returnByValue": True,
                        "awaitPromise": True,
                    },
                }))
                while True:
                    message = json.loads(ws.recv())
                    if message.get("id") != 1:
                        continue
                    result = message.get("result", {})
                    return (result.get("result", {}).get("value"),
                            result.get("exceptionDetails"))
            finally:
                ws.close()
        except Exception as exc:
            last_error = exc
            time.sleep(1)
    raise RuntimeError(str(last_error))


def main() -> int:
    failed = 0

    ready = False
    for _ in range(40):
        try:
            state, error = evaluate("document.readyState + '|' + typeof toolDeclarations",
                                    timeout=10, attempts=1)
            if not error and str(state).startswith("complete|function"):
                ready = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    if not ready:
        print("FAIL: Jarvis HUD did not finish loading")
        return 1

    expressions = {
        "tools": "JSON.stringify(toolDeclarations().map(function(t){return t.name}))",
        "routes": "JSON.stringify([" +
                  ",".join("typeof reel" + n for n in [
                      "IssOperation", "ImageOperation", "VideoOperation",
                      "CommerceOperation", "AnalyticsOperation",
                      "NotificationOperation", "PhoneAgentOperation",
                      "GameOperation"]) + "])",
        "native": "JSON.stringify([" +
                  ",".join("reelNative('" + m + "')" for m in [
                      "pickMedia", "editPhoto", "trimVideo", "openMedia",
                      "mediaSelfTest"]) + "])",
        "mediaSelfTest": "Native.mediaSelfTest()",
        "commands": "(async()=>{" +
                    "localStorage.removeItem('jv.reel.shopping');" +
                    "localStorage.removeItem('jv.reel.ntfy');" +
                    "const a=await reelCommerceOperation({action:'add',item:'eggs'});" +
                    "const b=await reelCommerceOperation({action:'list'});" +
                    "await reelNotificationOperation({action:'configure',topic:'jarvis_qa_topic'});" +
                    "const c=await reelNotificationOperation({action:'send',message:'test'});" +
                    "const d=await reelPhoneAgentOperation({action:'call',phone:'+123'});" +
                    "const e=await reelGameOperation({action:'status'});" +
                    "localStorage.removeItem('jv.reel.ntfy');" +
                    "return JSON.stringify({a:a,b:b,c:c,d:d,e:e});})()",
        "iss": "(async()=>JSON.stringify(await reelIssOperation({action:'status'})))()",
        "selfTest": "window.__jarvisSelfTest ? window.__jarvisSelfTest() : 'NO_SELFTEST'",
    }

    for name, expression in expressions.items():
        try:
            value, exception = evaluate(expression)
            if exception:
                print(f"FAIL {name}: {exception.get('text')}")
                failed += 1
                continue
            print(f"PASS {name}: {str(value)[:500]}")
            if name == "tools":
                tools = json.loads(value) if isinstance(value, str) else value
                needed = {"iss_operation", "image_operation", "video_operation",
                          "commerce_operation", "analytics_operation",
                          "notification_operation", "phone_agent_operation",
                          "game_operation"}
                if not needed.issubset(set(tools)):
                    print("FAIL: reel tools missing")
                    failed += 1
            if name == "mediaSelfTest":
                media = json.loads(value) if isinstance(value, str) else value
                if not media.get("ok"):
                    print(f"FAIL: native media self-test {media}")
                    failed += 1
            if name == "commands":
                data = json.loads(value) if isinstance(value, str) else value
                if not data["a"].get("ok") or "eggs" not in data["b"].get("message", ""):
                    print("FAIL: grocery list did not persist")
                    failed += 1
                if not data["c"].get("needs_user_action") or not data["d"].get("needs_user_action"):
                    print("FAIL: alert/call confirmation gate missing")
                    failed += 1
                if not data["e"].get("ok"):
                    print("FAIL: mobile game status was not honest")
                    failed += 1
            if name == "iss":
                data = json.loads(value) if isinstance(value, str) else value
                if not data.get("ok") or "latitude" not in str(data.get("message", "")):
                    print(f"FAIL: live ISS lookup {data}")
                    failed += 1
            if name == "selfTest" and isinstance(value, str) and value != "NO_SELFTEST":
                selftest = json.loads(value)
                if not selftest.get("reelMedia"):
                    print("FAIL: reelMedia false")
                    failed += 1
                media = selftest.get("reelMediaSelfTest")
                if not media or not media.get("ok"):
                    print(f"FAIL: reelMediaSelfTest {media}")
                    failed += 1
        except Exception as exc:
            print(f"FAIL {name}: {exc}")
            failed += 1
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
