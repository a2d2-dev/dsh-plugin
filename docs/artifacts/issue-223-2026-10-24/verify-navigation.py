#!/usr/bin/env python3
"""在既有 GUI 原历史会话上验证接续导航；只点击查看，不发送业务输入。"""
import json
import os
import subprocess
import time

SESSION = os.environ.get('A2D2_BROWSER_SESSION', 'a2d2-jump')
OLD_SESSION = 'session-9af116ad-e4ab-4a92-b9d5-6207d324983a'
CURRENT_SESSION = 'session-7353477e-dcc2-4e6e-b8c3-5df486cfbe9e'


def cli(*args):
    result = subprocess.run(['agent-browser', '--session', SESSION, *args], capture_output=True, text=True, timeout=40)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip())
    return result.stdout.strip()


def js(expression):
    return json.loads(cli('eval', expression))


def verify():
    initial = js('({title:document.title, selected:document.querySelector("[role=treeitem][aria-selected=true]")?.textContent, sessionKey:document.querySelector("[role=treeitem][aria-selected=true]")?.getAttribute("data-row-key"), buttons:[...document.querySelectorAll("button")].filter(b=>b.textContent==="进入当前处理会话").length})')
    assert initial.get('sessionKey') == 'session:' + OLD_SESSION, initial
    assert initial['buttons'] > 0, initial
    # 顶部关闭的关联任务详情也有同名按钮；使用可见的原生底部交接卡。
    cli('eval', '[...document.querySelectorAll("button")].filter(b=>b.textContent==="进入当前处理会话").at(-1).click()')
    deadline = time.monotonic() + 45
    last = {}
    while time.monotonic() < deadline:
        last = js('({title:document.title, selected:document.querySelector("[role=treeitem][aria-selected=true]")?.textContent, sessionKey:document.querySelector("[role=treeitem][aria-selected=true]")?.getAttribute("data-row-key"), alerts:[...document.querySelectorAll("[role=alert]")].map(e=>e.textContent)})')
        if any('当前处理会话暂不可进入' in alert for alert in last['alerts']):
            raise AssertionError(json.dumps({'result': 'FAIL', 'expectedCurrentSession': CURRENT_SESSION, 'actual': last}, ensure_ascii=False))
        if last.get('sessionKey') == 'session:' + CURRENT_SESSION:
            print(json.dumps({'result': 'PASS', 'sourceSession': OLD_SESSION, 'currentSession': CURRENT_SESSION, 'actual': last}, ensure_ascii=False))
            return
        time.sleep(0.5)
    raise AssertionError(json.dumps({'result': 'FAIL', 'reason': 'navigation-timeout', 'actual': last}, ensure_ascii=False))


if __name__ == '__main__':
    verify()
