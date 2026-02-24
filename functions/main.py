"""
Firebase Cloud Functions (Python Gen 2)
기출문제 JSON → HWPX 변환 API
"""

import os
import re
import json
import tempfile
import base64
from firebase_functions import https_fn, options
from md2hwpx.marko_adapter import MarkoToPandocAdapter
from md2hwpx import MarkdownToHwpx
import md2hwpx

# CORS 허용 (Vercel + localhost 개발 환경)
CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5174",
    "http://localhost:5175",
    "http://localhost:4173",
    "https://storybook-eight-tau.vercel.app",
    "https://*.vercel.app",
]


# ═══════════════════════════════════════════
# 문제 텍스트 파싱 유틸리티
# ═══════════════════════════════════════════

def split_question_text(text: str) -> tuple:
    """
    문제 텍스트에서 지시문, 지문, 보기를 분리합니다.
    기존 hwp_converter.py의 로직을 재현.
    """
    # [정답]과 [해설] 제거
    text = re.sub(r'\[정답\].*', '', text, flags=re.DOTALL).strip()
    text = re.sub(r'\[해설\].*', '', text, flags=re.DOTALL).strip()

    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return "", "", ""

    instruction = ""
    stem_lines = []
    option_lines = []
    option_started = False

    # 첫 줄이 [문제]로 시작하면 지시문
    if lines[0].startswith("[문제]"):
        instruction = re.sub(r'\[문제\]\s*', '', lines[0]).strip()
        start_idx = 1
    elif "[문제]" in lines[0]:
        instruction = re.sub(r'\[문제\]\s*', '', lines[0]).strip()
        start_idx = 1
    else:
        start_idx = 0

    for line in lines[start_idx:]:
        if not option_started and re.match(r'^[①②③④⑤⑥⑦⑧⑨⑩]', line):
            option_started = True
        if option_started:
            option_lines.append(line)
        else:
            stem_lines.append(line)

    return instruction, "\n".join(stem_lines), "\n".join(option_lines)


def process_formatting_markers(text: str) -> str:
    """
    기존 hwp_converter.py의 서식 마커를 Markdown 서식으로 변환합니다.
    ##text## → **text** (볼드), ***text*** → **text** (볼드)
    **text** → *text* (이탤릭으로 밑줄 대용)
    <table>text</table> → 코드 블록
    """
    # ##...## → 볼드 (Markdown **...**)
    text = re.sub(r'##([^#]+)##', r'**\1**', text)
    # <table>...</table> → 코드 블록
    text = re.sub(r'<table>([\s\S]*?)</table>', r'\n```\n\1\n```\n', text, flags=re.IGNORECASE)
    return text


# ═══════════════════════════════════════════
# JSON → Markdown 변환
# ═══════════════════════════════════════════

def questions_to_markdown(questions: list, title: str = "기출문제 정리") -> str:
    """
    Question 배열을 시험지 형식의 Markdown으로 변환합니다.
    
    기존 hwp_converter.py의 스타일 매핑:
      - 출처 (StyleShortcut2) → H2 헤더
      - 지시문 (StyleShortcut4) → Bold 텍스트
      - 지문 (StyleShortcut6) → 인용 블록 (blockquote)
      - 보기 (StyleShortcut8) → 일반 텍스트
      - 정답/해설 (Endnote) → 각주 표시
    """
    lines = []
    lines.append(f"# {title}\n")

    current_source = ""

    for i, q in enumerate(questions):
        number = q.get("number", i + 1)
        source = q.get("source", "")
        text = q.get("text", "")
        answer = q.get("answer", "")
        explanation = q.get("explanation", "")

        # 출처가 변경되었을 때만 헤더 삽입
        if source and source != current_source:
            lines.append(f"## {source}\n")
            current_source = source

        # 문제 텍스트 파싱
        instruction, passage, options_text = split_question_text(text)

        # 서식 마커 처리
        instruction = process_formatting_markers(instruction) if instruction else ""
        passage = process_formatting_markers(passage) if passage else ""
        options_text = process_formatting_markers(options_text) if options_text else ""

        # 지시문 (문제 헤더) - 볼드
        if instruction:
            lines.append(f"**{number}. {instruction}**\n")
        else:
            lines.append(f"**{number}.**\n")

        # 지문 - 인용 블록
        if passage:
            for p_line in passage.split("\n"):
                p_line = p_line.strip()
                if p_line:
                    lines.append(f"> {p_line}")
            lines.append("")

        # 보기 - 원문자 줄바꿈 유지
        if options_text:
            for opt_line in options_text.split("\n"):
                opt_line = opt_line.strip()
                if opt_line:
                    lines.append(opt_line)
            lines.append("")

        # 정답 & 해설
        if answer or explanation:
            answer_parts = []
            if answer:
                answer_parts.append(f"정답: {answer}")
            if explanation:
                answer_parts.append(f"해설: {explanation}")
            lines.append(f"*{' | '.join(answer_parts)}*\n")

        # 문제 구분선
        lines.append("---\n")

    return "\n".join(lines)


# ═══════════════════════════════════════════
# HWPX 변환 핵심 함수
# ═══════════════════════════════════════════

def convert_to_hwpx_bytes(json_data: dict, title: str = "기출문제 정리") -> bytes:
    """
    JSON 데이터를 HWPX 바이트로 변환합니다.
    
    Returns:
        bytes: HWPX 파일의 바이트 데이터
    """
    questions = json_data.get("questions", [])
    if not questions:
        raise ValueError("변환할 문제가 없습니다")

    # 1. JSON → Markdown
    markdown = questions_to_markdown(questions, title)

    # 2. Markdown → Pandoc AST
    adapter = MarkoToPandocAdapter()
    json_ast = adapter.parse(markdown)

    # 3. 임시 파일로 변환
    with tempfile.TemporaryDirectory() as tmpdir:
        md_path = os.path.join(tmpdir, "exam.md")
        hwpx_path = os.path.join(tmpdir, "exam.hwpx")

        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown)

        # md2hwpx 기본 blank 템플릿 사용
        blank_template = os.path.join(
            os.path.dirname(md2hwpx.__file__), "blank.hwpx"
        )
        MarkdownToHwpx.convert_to_hwpx(
            md_path, hwpx_path, reference_path=blank_template, json_ast=json_ast
        )

        with open(hwpx_path, "rb") as f:
            return f.read()


# ═══════════════════════════════════════════
# Firebase Cloud Function (HTTP 엔드포인트)
# ═══════════════════════════════════════════

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins=CORS_ORIGINS,
        cors_methods=["POST", "OPTIONS"],
    ),
    memory=options.MemoryOption.MB_256,
    timeout_sec=60,
    region="asia-northeast3",  # 서울 리전
)
def convert_to_hwpx(req: https_fn.Request) -> https_fn.Response:
    """
    POST /convert_to_hwpx
    
    Request Body (JSON):
    {
        "title": "시험지 제목",
        "questions": [
            {
                "number": 1,
                "source": "출처",
                "text": "문제 텍스트",
                "answer": "정답",
                "explanation": "해설"
            }
        ]
    }
    
    Response:
    {
        "success": true,
        "filename": "기출문제_2026-02-24.hwpx",
        "data": "<base64 encoded hwpx>"
    }
    """
    # OPTIONS preflight
    if req.method == "OPTIONS":
        return https_fn.Response("", status=204)

    if req.method != "POST":
        return https_fn.Response(
            json.dumps({"error": "POST 요청만 지원합니다"}),
            status=405,
            content_type="application/json",
        )

    try:
        body = req.get_json(silent=True)
        if not body:
            return https_fn.Response(
                json.dumps({"error": "JSON 요청 본문이 필요합니다"}),
                status=400,
                content_type="application/json",
            )

        title = body.get("title", "기출문제 정리")
        questions = body.get("questions", [])

        if not questions:
            return https_fn.Response(
                json.dumps({"error": "변환할 문제가 없습니다"}),
                status=400,
                content_type="application/json",
            )

        # HWPX 변환
        hwpx_bytes = convert_to_hwpx_bytes(
            {"questions": questions}, title=title
        )

        # Base64 인코딩하여 반환
        from datetime import datetime

        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = f"{title}_{date_str}.hwpx"

        return https_fn.Response(
            json.dumps({
                "success": True,
                "filename": filename,
                "data": base64.b64encode(hwpx_bytes).decode("utf-8"),
                "size": len(hwpx_bytes),
            }),
            status=200,
            content_type="application/json",
        )

    except Exception as e:
        return https_fn.Response(
            json.dumps({"error": f"변환 실패: {str(e)}"}),
            status=500,
            content_type="application/json",
        )
