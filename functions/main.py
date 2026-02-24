"""
Firebase Cloud Functions (Python Gen 2)
기출문제 JSON → HWPX 변환 API

이중 방식:
  A) 템플릿 기반 변환: 사용자 업로드 .hwpx 템플릿의 스타일/레이아웃 보존
  B) md2hwpx 기본 변환: 템플릿 없을 때 Markdown → HWPX 변환
"""

import os
import re
import json
import zipfile
import tempfile
import base64
import random
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
# JSON → Markdown 변환 (방식 B: md2hwpx용)
# ═══════════════════════════════════════════

def questions_to_markdown(questions: list, title: str = "기출문제 정리") -> str:
    """
    Question 배열을 시험지 형식의 Markdown으로 변환합니다.
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

        if source and source != current_source:
            lines.append(f"## {source}\n")
            current_source = source

        instruction, passage, options_text = split_question_text(text)

        instruction = process_formatting_markers(instruction) if instruction else ""
        passage = process_formatting_markers(passage) if passage else ""
        options_text = process_formatting_markers(options_text) if options_text else ""

        if instruction:
            lines.append(f"**{number}. {instruction}**\n")
        else:
            lines.append(f"**{number}.**\n")

        if passage:
            for p_line in passage.split("\n"):
                p_line = p_line.strip()
                if p_line:
                    lines.append(f"> {p_line}")
            lines.append("")

        if options_text:
            for opt_line in options_text.split("\n"):
                opt_line = opt_line.strip()
                if opt_line:
                    lines.append(opt_line)
            lines.append("")

        if answer or explanation:
            answer_parts = []
            if answer:
                answer_parts.append(f"정답: {answer}")
            if explanation:
                answer_parts.append(f"해설: {explanation}")
            lines.append(f"*{' | '.join(answer_parts)}*\n")

        lines.append("---\n")

    return "\n".join(lines)


# ═══════════════════════════════════════════
# 방식 B: md2hwpx 기본 변환
# ═══════════════════════════════════════════

def convert_to_hwpx_default(json_data: dict, title: str = "기출문제 정리") -> bytes:
    """
    md2hwpx 라이브러리로 기본 변환 (템플릿 없을 때)
    """
    questions = json_data.get("questions", [])
    if not questions:
        raise ValueError("변환할 문제가 없습니다")

    markdown = questions_to_markdown(questions, title)

    adapter = MarkoToPandocAdapter()
    json_ast = adapter.parse(markdown)

    with tempfile.TemporaryDirectory() as tmpdir:
        md_path = os.path.join(tmpdir, "exam.md")
        hwpx_path = os.path.join(tmpdir, "exam.hwpx")

        with open(md_path, "w", encoding="utf-8") as f:
            f.write(markdown)

        blank_template = os.path.join(
            os.path.dirname(md2hwpx.__file__), "blank.hwpx"
        )
        MarkdownToHwpx.convert_to_hwpx(
            md_path, hwpx_path, reference_path=blank_template, json_ast=json_ast
        )

        with open(hwpx_path, "rb") as f:
            return f.read()


# ═══════════════════════════════════════════
# 방식 A: 템플릿 기반 HWPX XML 직접 조작
# ═══════════════════════════════════════════

def _xml_escape(text: str) -> str:
    """XML 특수문자 이스케이프"""
    text = text.replace('&', '&amp;')
    text = text.replace('<', '&lt;')
    text = text.replace('>', '&gt;')
    text = text.replace('"', '&quot;')
    text = text.replace("'", '&apos;')
    return text


def _unique_id() -> str:
    """HWPX 문단 고유 ID 생성"""
    return str(random.randint(100000000, 2147483647))


def _make_paragraph(text: str, style_id: int, para_pr_id: int, char_pr_id: int) -> str:
    """
    단일 HWPX 문단 XML을 생성합니다.
    
    Args:
        text: 문단 텍스트 (줄바꿈은 \\n)
        style_id: 스타일 ID (styleIDRef)
        para_pr_id: 문단 속성 ID (paraPrIDRef)  
        char_pr_id: 문자 속성 ID (charPrIDRef)
    """
    pid = _unique_id()
    escaped = _xml_escape(text)
    
    # 줄바꿈 처리: 각 줄을 별도의 run으로
    lines = escaped.split('\n')
    runs_xml = ""
    for i, line in enumerate(lines):
        line = line.strip()
        if not line:
            continue
        if i > 0:
            # 줄바꿈: 새 문단 대신 run 내에서 처리
            runs_xml += f'<hp:run charPrIDRef="{char_pr_id}"><hp:t>{line}</hp:t></hp:run>'
        else:
            runs_xml += f'<hp:run charPrIDRef="{char_pr_id}"><hp:t>{line}</hp:t></hp:run>'
    
    if not runs_xml:
        runs_xml = f'<hp:run charPrIDRef="{char_pr_id}"><hp:t/></hp:run>'
    
    return (
        f'<hp:p id="{pid}" paraPrIDRef="{para_pr_id}" '
        f'styleIDRef="{style_id}" pageBreak="0" columnBreak="0" merged="0">'
        f'{runs_xml}</hp:p>'
    )


def _make_paragraph_with_endnote(
    text: str, style_id: int, para_pr_id: int, char_pr_id: int,
    endnote_text: str, endnote_num: int, endnote_char_pr_id: int, endnote_para_pr_id: int
) -> str:
    """
    미주(Endnote)가 포함된 HWPX 문단을 생성합니다.
    문제 지시문 끝에 미주를 달아 정답/해설을 넣습니다.
    """
    pid = _unique_id()
    endnote_pid = _unique_id()
    endnote_sub_id = _unique_id()
    escaped_text = _xml_escape(text)
    escaped_note = _xml_escape(endnote_text)
    
    return (
        f'<hp:p id="{pid}" paraPrIDRef="{para_pr_id}" '
        f'styleIDRef="{style_id}" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="{char_pr_id}"><hp:t>{escaped_text}</hp:t></hp:run>'
        f'<hp:run charPrIDRef="{char_pr_id}">'
        f'<hp:ctrl>'
        f'<hp:endNote id="{endnote_pid}" number="{endnote_num}">'
        f'<hp:subList id="{endnote_sub_id}" textDirection="HORIZONTAL" '
        f'lineWrap="BREAK" vertAlign="TOP" linkListIDRef="0" linkListNextIDRef="0" '
        f'textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">'
        f'<hp:p id="{_unique_id()}" paraPrIDRef="{endnote_para_pr_id}" '
        f'styleIDRef="17" pageBreak="0" columnBreak="0" merged="0">'
        f'<hp:run charPrIDRef="{endnote_char_pr_id}"><hp:t>{escaped_note}</hp:t></hp:run>'
        f'</hp:p>'
        f'</hp:subList>'
        f'</hp:endNote>'
        f'</hp:ctrl>'
        f'</hp:run>'
        f'</hp:p>'
    )


# 템플릿 스타일 매핑 (template.hwpx 기준)
# StyleShortcut0 → id=0 바탕글    (paraPr=0, charPr=11)
# StyleShortcut2 → id=1 원본문제풀이 (paraPr=1, charPr=19) → 출처
# StyleShortcut4 → id=3 문제       (paraPr=18, charPr=16) → 지시문
# StyleShortcut6 → id=5 본문       (paraPr=5, charPr=14)  → 지문
# StyleShortcut8 → id=7 보기문     (paraPr=14, charPr=16) → 선택지
# 미주 스타일    → id=17           (paraPr=15, charPr=8)  → 정답/해설

STYLE_MAP = {
    "source":      {"style": 1,  "paraPr": 1,  "charPr": 19},  # 출처
    "instruction": {"style": 3,  "paraPr": 18, "charPr": 16},  # 문제 지시문
    "stem":        {"style": 5,  "paraPr": 5,  "charPr": 14},  # 지문
    "options":     {"style": 7,  "paraPr": 14, "charPr": 16},  # 보기문
    "endnote":     {"style": 17, "paraPr": 15, "charPr": 8},   # 미주
}


def convert_with_template(template_bytes: bytes, json_data: dict, title: str = "기출문제 정리") -> bytes:
    """
    사용자 템플릿을 기반으로 HWPX를 생성합니다.
    
    1. 템플릿 ZIP 해제
    2. header.xml (스타일/글꼴 정의) 그대로 보존
    3. section0.xml에 문제 내용 문단 삽입
    4. 다시 ZIP 압축하여 반환
    """
    questions = json_data.get("questions", [])
    if not questions:
        raise ValueError("변환할 문제가 없습니다")

    with tempfile.TemporaryDirectory() as tmpdir:
        template_path = os.path.join(tmpdir, "template.hwpx")
        output_path = os.path.join(tmpdir, "output.hwpx")

        # 1. 템플릿 저장 및 해제
        with open(template_path, "wb") as f:
            f.write(template_bytes)

        with zipfile.ZipFile(template_path, "r") as zin:
            section_xml = zin.read("Contents/section0.xml").decode("utf-8")
            all_files = {}
            for info in zin.infolist():
                all_files[info.filename] = zin.read(info.filename)

        # 2. section0.xml에서 구조 부분(첫 문단) 추출
        # 첫 번째 </hp:p> 까지가 구조 문단 (컬럼/페이지 설정 포함)
        # 이 부분은 그대로 유지하고, 그 뒤에 내용 문단을 추가
        close_sec_tag = "</hs:sec>"
        first_p_end = section_xml.find("</hp:p>")
        
        if first_p_end == -1:
            raise ValueError("템플릿 section0.xml 파싱 실패: </hp:p> 태그 없음")
        
        # 구조 부분: 섹션 시작 ~ 첫 문단 끝
        structural_part = section_xml[:first_p_end + len("</hp:p>")]
        
        # 3. 문제별 내용 문단 생성
        content_paragraphs = []
        current_source = ""
        endnote_counter = 1

        for i, q in enumerate(questions):
            number = q.get("number", i + 1)
            source = q.get("source", "")
            text = q.get("text", "")
            answer = q.get("answer", "")
            explanation = q.get("explanation", "")

            # 출처 변경 시 출처 문단 삽입
            if source and source != current_source:
                s = STYLE_MAP["source"]
                content_paragraphs.append(
                    _make_paragraph(source, s["style"], s["paraPr"], s["charPr"])
                )
                current_source = source

            # 문제 텍스트 파싱
            instruction, passage, options_text = split_question_text(text)

            # 지시문 (문제 헤더) + 미주(정답/해설)
            instruction_text = f"{number}. {instruction}" if instruction else f"{number}."
            
            s_inst = STYLE_MAP["instruction"]
            if answer or explanation:
                # 정답/해설이 있으면 미주 포함
                endnote_parts = []
                if answer:
                    endnote_parts.append(f"정답: {answer}")
                if explanation:
                    endnote_parts.append(f"해설: {explanation}")
                endnote_content = " | ".join(endnote_parts)
                
                s_note = STYLE_MAP["endnote"]
                content_paragraphs.append(
                    _make_paragraph_with_endnote(
                        instruction_text,
                        s_inst["style"], s_inst["paraPr"], s_inst["charPr"],
                        endnote_content, endnote_counter,
                        s_note["charPr"], s_note["paraPr"]
                    )
                )
                endnote_counter += 1
            else:
                content_paragraphs.append(
                    _make_paragraph(instruction_text, s_inst["style"], s_inst["paraPr"], s_inst["charPr"])
                )

            # 지문 (제시문) - 여러 줄이면 각각 별도 문단
            if passage:
                s_stem = STYLE_MAP["stem"]
                for line in passage.split("\n"):
                    line = line.strip()
                    if line:
                        content_paragraphs.append(
                            _make_paragraph(line, s_stem["style"], s_stem["paraPr"], s_stem["charPr"])
                        )

            # 보기문 - 각 선택지를 별도 문단으로
            if options_text:
                s_opt = STYLE_MAP["options"]
                for line in options_text.split("\n"):
                    line = line.strip()
                    if line:
                        content_paragraphs.append(
                            _make_paragraph(line, s_opt["style"], s_opt["paraPr"], s_opt["charPr"])
                        )

            # 문제 사이 빈 문단 (간격)
            content_paragraphs.append(
                _make_paragraph("", STYLE_MAP["stem"]["style"], STYLE_MAP["stem"]["paraPr"], STYLE_MAP["stem"]["charPr"])
            )

        # 4. 새 section0.xml 조립
        new_section = structural_part + "".join(content_paragraphs) + close_sec_tag

        # 5. 출력 HWPX ZIP 생성
        with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for filename, data in all_files.items():
                if filename == "Contents/section0.xml":
                    zout.writestr(filename, new_section.encode("utf-8"))
                else:
                    zout.writestr(filename, data)

        with open(output_path, "rb") as f:
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
    
    이중 방식: template_base64가 있으면 템플릿 기반 변환, 없으면 md2hwpx 기본 변환
    
    Request Body (JSON):
    {
        "title": "시험지 제목",
        "questions": [...],
        "template_base64": "(선택) 사용자 .hwpx 템플릿 Base64"
    }
    
    Response:
    {
        "success": true,
        "mode": "template" | "default",
        "filename": "시험지제목_2026-02-24.hwpx",
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
        template_base64 = body.get("template_base64", None)

        if not questions:
            return https_fn.Response(
                json.dumps({"error": "변환할 문제가 없습니다"}),
                status=400,
                content_type="application/json",
            )

        # 이중 방식: 템플릿 유무에 따라 분기
        if template_base64:
            # 방식 A: 템플릿 기반 변환
            template_bytes = base64.b64decode(template_base64)
            hwpx_bytes = convert_with_template(
                template_bytes, {"questions": questions}, title=title
            )
            mode = "template"
        else:
            # 방식 B: md2hwpx 기본 변환
            hwpx_bytes = convert_to_hwpx_default(
                {"questions": questions}, title=title
            )
            mode = "default"

        # Base64 인코딩하여 반환
        from datetime import datetime

        date_str = datetime.now().strftime("%Y-%m-%d")
        filename = f"{title}_{date_str}.hwpx"

        return https_fn.Response(
            json.dumps({
                "success": True,
                "mode": mode,
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
