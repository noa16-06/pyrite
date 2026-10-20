"""Pytest plugin that reports test progress to Pyrite as JSON lines.

Pyrite loads it with ``-p pyrite_pytest`` and sets PYRITE_TEST_REPORT to a file it
follows while the tests run (PyCharm does the same with its teamcity plugin, but
writes to stdout). Events:

  {"event": "collected", "tests": [test...]}
  {"event": "start", "id": ...}
  {"event": "result", "id": ..., "outcome": ..., "duration": ..., "output": ...}
  {"event": "collect_error", "path": ..., "output": ...}
  {"event": "finish", "exitstatus": ...}
"""
import json
import os

_report = None
_results = {}


def _emit(**event):
    if _report is None:
        return
    _report.write(json.dumps(event) + "\n")
    _report.flush()


def _describe(item):
    cls = getattr(item, "cls", None)
    return {
        "id": item.nodeid,
        "path": str(getattr(item, "path", None) or item.fspath),
        "cls": cls.__name__ if cls is not None else None,
        "func": getattr(item, "originalname", None) or item.name,
        "name": item.name,
        "line": (item.location[1] or 0) + 1,
    }


def pytest_configure(config):
    global _report
    path = os.environ.get("PYRITE_TEST_REPORT")
    # Only in the main process (not in pytest-xdist workers).
    if path and not hasattr(config, "workerinput"):
        _report = open(path, "a", encoding="utf-8")


def pytest_unconfigure(config):
    global _report
    if _report is not None:
        _report.close()
        _report = None


def pytest_collection_finish(session):
    _emit(event="collected", tests=[_describe(item) for item in session.items])


def pytest_collectreport(report):
    if report.failed:
        _emit(event="collect_error", path=os.path.abspath(str(report.fspath)), output=str(report.longrepr))


def pytest_runtest_logstart(nodeid, location):
    _results[nodeid] = _new_result()
    _emit(event="start", id=nodeid)


def _new_result():
    return {"outcome": "passed", "duration": 0.0, "sections": [], "errors": []}


def pytest_runtest_logreport(report):
    result = _results.setdefault(report.nodeid, _new_result())
    result["duration"] += report.duration
    wasxfail = hasattr(report, "wasxfail")
    if report.when == "call":
        if report.passed:
            result["outcome"] = "xpassed" if wasxfail else "passed"
        elif report.skipped:
            result["outcome"] = "xfailed" if wasxfail else "skipped"
        else:
            result["outcome"] = "failed"
    elif report.failed:
        # A failing fixture (setup/teardown) is an error, like pytest's "E" in the summary.
        result["outcome"] = "error"
    elif report.skipped and report.when == "setup":
        result["outcome"] = "skipped"
    # Each phase's report repeats the captured output of the phases before it.
    result["sections"] = [
        "----- %s -----\n%s" % (title, content.rstrip("\n")) for title, content in report.sections if content.strip()
    ]
    if report.longrepr is not None and (report.failed or report.skipped):
        text = report.longreprtext if report.failed else _skip_reason(report)
        if text:
            result["errors"].append(text)


def _skip_reason(report):
    longrepr = report.longrepr
    if isinstance(longrepr, tuple) and len(longrepr) == 3:
        return "Skipped: %s" % longrepr[2].replace("Skipped: ", "", 1)
    return str(longrepr)


def pytest_runtest_logfinish(nodeid, location):
    result = _results.pop(nodeid, None)
    if result is not None:
        _emit(
            event="result",
            id=nodeid,
            outcome=result["outcome"],
            duration=result["duration"],
            output="\n\n".join(result["errors"] + result["sections"]),
        )


def pytest_sessionfinish(session, exitstatus):
    _emit(event="finish", exitstatus=int(exitstatus))
