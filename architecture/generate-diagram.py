#!/usr/bin/env python3
"""Generate the editable Kyverno Governance Platform architecture diagram.

The diagram is intentionally made from ordinary SVG primitives so that it can
be edited in Inkscape, Illustrator, Figma (SVG import), or a text editor.
Technology logos are unchanged upstream assets embedded as self-contained images.
"""

from pathlib import Path
import base64
import html
import shutil
import subprocess


OUT = Path(__file__).parent
SVG_PATH = OUT / "architecture.svg"
HTML_PATH = OUT / "architecture.html"
PNG_PATH = OUT / "architecture.png"
PDF_PATH = OUT / "architecture.pdf"

W, H = 2400, 995


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def svg_text(x, y, text, size=20, color="#243447", weight=400, anchor="middle", cls=""):
    return f'<text x="{x}" y="{y}" text-anchor="{anchor}" font-size="{size}px" font-weight="{weight}" class="{cls}" fill="{color}">{esc(text)}</text>'


def icon(kind, x, y, color="#5272a0"):
    """Embed unchanged upstream artwork; only generic UI symbols are drawn here."""
    assets = {
        "alb": "aws-alb.svg",
        "next": "nextjs.png",
        "nest": "nestjs.svg",
        "db": "postgresql.svg",
        "kube": "kubernetes.svg",
        "kyverno": "kyverno.svg",
        "bedrock": "aws-bedrock-64.svg",
        "github": "github.svg",
        "actions": "github-actions.png",
        "ecr": "aws-ecr-64.svg",
    }
    if kind in assets:
        asset = OUT / "icons" / assets[kind]
        mime = "image/png" if asset.suffix == ".png" else "image/svg+xml"
        data = base64.b64encode(asset.read_bytes()).decode("ascii")
        return f'<image x="{x-3}" y="{y-2}" width="64" height="64" preserveAspectRatio="xMidYMid meet" href="data:{mime};base64,{data}"/>'
    if kind == "browser":
        body = f'<rect x="8" y="9" width="42" height="34" rx="5" fill="none" stroke="{color}" stroke-width="4"/><path d="M8 19h42" stroke="{color}" stroke-width="3"/><path d="M20 30l7 7 13-14" fill="none" stroke="{color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>'
    else:
        body = '<rect x="9" y="10" width="40" height="38" rx="5" fill="none" stroke="#73809a" stroke-width="3"/><path d="M18 25l7 6-7 6M30 38h10" fill="none" stroke="#73809a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
    return f'<g transform="translate({x},{y})">{body}</g>'


def card(x, y, w, h, title, subtitle, kind, accent="#5272a0", fill="#ffffff", note=""):
    return (f'<g class="card"><rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{fill}" stroke="#9ba7b4" stroke-width="1.7"/>'
            + icon(kind, x+w/2-29, y+15, accent)
            + svg_text(x+w/2, y+108, title, 24, "#233448", 700)
            + svg_text(x+w/2, y+133, subtitle, 18, "#526174")
            + (svg_text(x+w/2, y+h-14, note, 16, "#64748b") if note else "") + '</g>')


def boundary(x, y, w, h, title, subtitle, stroke="#b7c3d0", fill="#ffffff"):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="16" fill="{fill}" stroke="{stroke}" stroke-width="2"/>'
            + svg_text(x+24, y+34, title, 23, "#32465d", 700, "start")
            + svg_text(x+w-24, y+34, subtitle, 17, "#64748b", 400, "end"))


def path(d, label="", lx=0, ly=0, dashed=False, color="#526477", marker="url(#arrow)"):
    dash = ' stroke-dasharray="8 7"' if dashed else ""
    result = f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.3"{dash} marker-end="{marker}"/>'
    if label:
        result += f'<text x="{lx}" y="{ly}" text-anchor="middle" font-size="19" fill="{color}" stroke="white" stroke-width="8" paint-order="stroke" stroke-linejoin="round">{esc(label)}</text>'
    return result


def build_svg():
    s = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 145 {W} {H}" role="img">
<title>Kyverno Governance Platform — 배포 아키텍처</title>
<desc>Hub-Spoke 멀티클러스터 기반 AWS EKS 아키텍처. 브라우저가 ALB를 통해 Next.js와 NestJS에 접근한다. 백엔드는 PostgreSQL, Kubernetes API, Bedrock/룰엔진, MLOps 및 Spoke 클러스터별 GitHub PR과 연동한다.</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#526477"/></marker>
<filter id="shadow" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity="0.08"/></filter>
<style>text{{font-family:'Noto Sans CJK KR','Noto Sans KR','Malgun Gothic',Arial,sans-serif}}</style></defs>
<rect width="{W}" height="{H+200}" fill="white"/>''']
    # Physical runtime boundary, and a separate logical view of managed targets.
    s.append(boundary(650, 400, 750, 630, "AWS EKS · Hub 관리 클러스터", "namespace: kyverno-platform", "#9ab3a4", "#fbfdfb"))
    s.append(boundary(1680, 400, 650, 630, "관리 대상 Spoke 클러스터 1…N", "Hub & Spoke 구성", "#b3bcca", "#fcfdff"))
    s.append(svg_text(2005, 1010, "동일 Hub 클러스터 / 원격 Spoke EKS / 온-프레미스 K8s", 18, "#64748b"))
    # Nodes follow the reference's centered pictogram/card style.
    nodes = [
      (50, 490, 220, 170, "사용자 브라우저", "대시보드 · API", "browser", "#5272a0", ""),
      (350, 490, 230, 170, "AWS ALB", "인그레스 트래픽 라우팅", "alb", "#e17e2e", "AWS LB Controller 연동"),
      (720, 470, 260, 170, "Next.js", "프론트엔드 웹 UI", "next", "#243447", "ClusterIP Service / Pod"),
      (1050, 690, 280, 190, "NestJS", "거버넌스 코어 API", "nest", "#d94e65", "인증 · 승인 · MLOps 거버넌스"),
      (720, 810, 260, 170, "PostgreSQL 17", "플랫폼 데이터 저장소", "db", "#477bac", "사용자 · 예외 · 감사 · 위반"),
      (1050, 195, 280, 170, "Amazon Bedrock", "AI 설명 · 진단", "bedrock", "#e18a35", "IAM / IRSA · 룰 엔진 Fallback"),
      (1450, 195, 280, 170, "GitHub", "PolicyException PR", "github", "#324456", "Spoke 클러스터별 GitOps PR 발행"),
      (1720, 470, 260, 170, "Kubernetes API", "정책 · 예외 · 리소스", "kube", "#417cc3", "Spoke 클러스터별 연결 설정"),
      (2040, 470, 250, 170, "Kyverno", "정책 평가 엔진", "kyverno", "#cd9c32", "Admission / Background"),
      (1720, 810, 260, 170, "PolicyReport", "정책 검사 결과", "report", "#6d8cac", "실시간 감시 · 30초 DB 동기화"),
      (2040, 810, 250, 170, "MLOps & Workloads", "Kubeflow · KServe · Pod", "workload", "#528ba7", "GPU 쿼터 / FinOps 제어"),
    ]
    for x,y,w,h,title,subtitle,kind,accent,note in nodes:
        # Reports and workload resources share simple non-vendor pictograms.
        if kind == "report": kind = "script"
        if kind == "workload": kind = "kube"
        s.append(card(x,y,w,h,title,subtitle,kind,accent,note=note))
    # User traffic: ALB routes UI and API independently.
    s.append(path("M270 575H350", "HTTP", 310, 555))
    s.append(path("M580 535H720", "/", 645, 518))
    s.append(path("M580 615H615V775H1050", "/api · REST / SSE", 830, 753))
    s.append(path("M980 550H1015V720H1050", "내부 API", 1020, 668))
    # Backend is the only hub for database and external service calls.
    s.append(path("M1190 880V930H980", "Prisma · SQL", 1080, 915))
    s.append(path("M1190 690V365", "AI 분석 요청 · 응답", 1190, 590, True))
    s.append(path("M1270 690V382H1590V365", "예외 YAML · PR 생성", 1460, 397, True))
    # Independent read and mutation routes; no universal multicluster Watch claim.
    s.append(path("M1330 750H1510V525H1720", "정책·리소스 조회", 1545, 497))
    s.append(path("M1720 585H1550V790H1330", "PolicyReport 수집", 1460, 817))
    s.append(path("M1330 850H1620V615H1720", "승인 예외 적용·회수", 1480, 888))
    # Internal target cluster policy evaluation and report resources.
    s.append(path("M1980 530H2040"))
    s.append(path("M2040 590H1980"))
    s.append(path("M2165 640V810", "정책 검증", 2165, 728))
    s.append(path("M2075 640V758H1850V810", "검사 결과 생성", 1950, 744))
    s.append(path("M1760 810V640", "결과 조회", 1760, 710))
    s.append(path("M75 1080H145"))
    s.append(svg_text(162, 1087, "런타임 요청·데이터 흐름", 19, "#64748b", 400, "start"))
    s.append(path("M510 1080H580", dashed=True))
    s.append(svg_text(596, 1087, "선택 연동·비동기 흐름", 19, "#64748b", 400, "start"))
    s.append('</svg>')
    return ''.join(s)


def render_assets():
    svg = build_svg()
    SVG_PATH.write_text(svg, encoding="utf-8")
    HTML_PATH.write_text(f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>Kyverno Governance Platform</title><style>@page{{size:{W}px {H}px;margin:0}}html,body{{margin:0;padding:0;background:#fff}}main{{width:100%;max-width:2400px;margin:0 auto;background:#fff}}svg{{display:block;width:100%;height:auto}}@media print{{main{{width:2400px;height:{H}px;margin:0}}svg{{width:2400px;height:{H}px}}}}</style></head><body><main>{svg}</main></body></html>''', encoding="utf-8")

    if "--svg-only" in __import__("sys").argv:
        print(f"Generated {SVG_PATH.name} and {HTML_PATH.name}")
        return

    chrome = shutil.which("google-chrome") or shutil.which("google-chrome-stable") or shutil.which("chromium") or shutil.which("chromium-browser")
    if not chrome:
        print("SVG and HTML written; headless Chrome not found, PNG/PDF skipped")
        return
    url = HTML_PATH.resolve().as_uri()
    base = [chrome, "--headless", "--disable-gpu", "--disable-dev-shm-usage", "--disable-breakpad", "--no-sandbox", "--hide-scrollbars", f"--window-size={W},{H}", "--force-device-scale-factor=2"]
    try:
        subprocess.run(base + [f"--screenshot={PNG_PATH}", url], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(base + [f"--print-to-pdf={PDF_PATH}", "--no-pdf-header-footer", url], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"Generated {SVG_PATH.name}, {HTML_PATH.name}, {PNG_PATH.name}, {PDF_PATH.name}")
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"SVG and HTML written; headless Chrome export failed ({exc}); PNG/PDF skipped")


if __name__ == "__main__":
    render_assets()
