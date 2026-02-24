import { useState } from 'react';

export interface AnalysisResult {
  summary: {
    total_questions: number;
    overall_difficulty: string;
    exam_name?: string;
    trend_analysis: string;
  };
  type_classification: {
    type: string;
    count: number;
    question_numbers: number[];
    difficulty_avg: string;
  }[];
  difficulty_distribution: {
    high: number;
    mid: number;
    low: number;
  };
  killer_questions: {
    q_number: number;
    type: string;
    reason: string;
    strategy: string;
  }[];
  study_plan: {
    priority: number;
    area: string;
    content: string;
    target_types: string[];
  }[];
}

interface AnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: AnalysisResult | null;
  examName: string;
  isLoading: boolean;
}

const difficultyColor = (d: string) => {
  if (d.includes('상')) return 'text-red-600 bg-red-50';
  if (d.includes('하')) return 'text-green-600 bg-green-50';
  return 'text-yellow-600 bg-yellow-50';
};

function toPlainText(data: AnalysisResult, examName: string): string {
  const lines: string[] = [];
  lines.push(`[ ${examName} 시험 분석 ]`);
  lines.push('');
  lines.push(`[종합 총평]`);
  lines.push(`총 문항: ${data.summary.total_questions}문제`);
  lines.push(`전체 난이도: ${data.summary.overall_difficulty}`);
  lines.push(data.summary.trend_analysis);
  lines.push('');
  lines.push(`[유형별 분류]`);
  for (const t of data.type_classification) {
    lines.push(`  ${t.type}: ${t.count}문제 (난이도 ${t.difficulty_avg}) - ${t.question_numbers.join(', ')}번`);
  }
  lines.push('');
  const total = data.summary.total_questions || 1;
  lines.push(`[난이도 분포]`);
  lines.push(`  상: ${data.difficulty_distribution.high}문제 (${Math.round((data.difficulty_distribution.high / total) * 100)}%)`);
  lines.push(`  중: ${data.difficulty_distribution.mid}문제 (${Math.round((data.difficulty_distribution.mid / total) * 100)}%)`);
  lines.push(`  하: ${data.difficulty_distribution.low}문제 (${Math.round((data.difficulty_distribution.low / total) * 100)}%)`);
  lines.push('');
  if (data.killer_questions.length > 0) {
    lines.push(`[킬러문항]`);
    for (const kq of data.killer_questions) {
      lines.push(`  ${kq.q_number}번 (${kq.type})`);
      lines.push(`    이유: ${kq.reason}`);
      lines.push(`    전략: ${kq.strategy}`);
    }
    lines.push('');
  }
  if (data.study_plan.length > 0) {
    lines.push(`[학습 계획]`);
    for (const sp of data.study_plan) {
      lines.push(`  ${sp.priority}. ${sp.area}`);
      lines.push(`    ${sp.content}`);
      if (sp.target_types.length > 0) {
        lines.push(`    관련 유형: ${sp.target_types.join(', ')}`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

export default function AnalysisModal({ isOpen, onClose, data, examName, isLoading }: AnalysisModalProps) {
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSaveJson = () => {
    if (!data) return;
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${examName || '시험분석'}_분석결과.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!data) return;
    const content = toPlainText(data, examName);
    await navigator.clipboard.writeText(content);
    setCopyStatus('복사됨!');
    setTimeout(() => setCopyStatus(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[720px] max-h-[85vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-800">시험지 분석 결과</h2>
            {examName && <p className="text-xs text-gray-500 mt-0.5">{examName}</p>}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <svg className="animate-spin w-8 h-8 text-blue-600" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-500">Gemini가 시험지를 분석하고 있습니다...</p>
            </div>
          )}

          {!isLoading && !data && (
            <div className="text-center py-16 text-gray-400"><p>분석 결과가 없습니다.</p></div>
          )}

          {!isLoading && data && (
            <>
              {/* 종합 총평 */}
              <section>
                <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-blue-600 rounded-full inline-block" />종합 총평
                </h3>
                <div className="bg-blue-50 rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-gray-600">총 문항: <span className="font-bold text-blue-700">{data.summary.total_questions}문제</span></span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${difficultyColor(data.summary.overall_difficulty)}`}>
                      난이도: {data.summary.overall_difficulty}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700 leading-relaxed">{data.summary.trend_analysis}</p>
                </div>
              </section>

              {/* 유형 분류 */}
              <section>
                <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-purple-600 rounded-full inline-block" />유형별 분류
                </h3>
                <div className="overflow-hidden rounded-xl border border-gray-200">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">유형</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600">문항수</th>
                        <th className="text-center px-4 py-2 font-medium text-gray-600">난이도</th>
                        <th className="text-left px-4 py-2 font-medium text-gray-600">문항 번호</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data.type_classification.map((t, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-medium text-gray-800">{t.type}</td>
                          <td className="px-4 py-2 text-center text-gray-600">{t.count}</td>
                          <td className="px-4 py-2 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${difficultyColor(t.difficulty_avg)}`}>{t.difficulty_avg}</span>
                          </td>
                          <td className="px-4 py-2 text-gray-500 text-xs">{t.question_numbers.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 난이도 분포 */}
              <section>
                <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <span className="w-1.5 h-5 bg-yellow-500 rounded-full inline-block" />난이도 분포
                </h3>
                <div className="flex items-center gap-4">
                  {[
                    { label: '상', count: data.difficulty_distribution.high, color: 'bg-red-500' },
                    { label: '중', count: data.difficulty_distribution.mid, color: 'bg-yellow-500' },
                    { label: '하', count: data.difficulty_distribution.low, color: 'bg-green-500' },
                  ].map((d) => {
                    const total = data.summary.total_questions || 1;
                    const pct = Math.round((d.count / total) * 100);
                    return (
                      <div key={d.label} className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">{d.label}</span>
                          <span className="text-xs text-gray-500">{d.count}문제 ({pct}%)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div className={`${d.color} rounded-full h-3 transition-all`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* 킬러문항 */}
              {data.killer_questions.length > 0 && (
                <section>
                  <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-5 bg-red-600 rounded-full inline-block" />킬러문항
                  </h3>
                  <div className="space-y-3">
                    {data.killer_questions.map((kq, i) => (
                      <div key={i} className="bg-red-50 rounded-xl p-4 border border-red-100">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded-full">{kq.q_number}번</span>
                          <span className="text-xs text-red-600 font-medium">{kq.type}</span>
                        </div>
                        <p className="text-sm text-gray-700 mb-1"><span className="font-medium text-gray-800">이유:</span> {kq.reason}</p>
                        <p className="text-sm text-gray-700"><span className="font-medium text-gray-800">전략:</span> {kq.strategy}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* 학습 계획 */}
              {data.study_plan.length > 0 && (
                <section>
                  <h3 className="text-base font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <span className="w-1.5 h-5 bg-green-600 rounded-full inline-block" />학습 계획
                  </h3>
                  <div className="space-y-3">
                    {data.study_plan.map((sp, i) => (
                      <div key={i} className="flex gap-3 bg-green-50 rounded-xl p-4 border border-green-100">
                        <div className="flex-shrink-0 w-8 h-8 bg-green-600 text-white rounded-full flex items-center justify-center text-sm font-bold">{sp.priority}</div>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-gray-800 mb-1">{sp.area}</p>
                          <p className="text-sm text-gray-700 leading-relaxed">{sp.content}</p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {sp.target_types.map((t, j) => (
                              <span key={j} className="px-2 py-0.5 bg-green-200 text-green-800 text-xs rounded-full">{t}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {/* 하단 */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            {data && (
              <>
                <button onClick={handleSaveJson} className="px-3 py-1.5 text-sm bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100">JSON 저장</button>
                <button onClick={handleCopy} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">텍스트 복사</button>
                {copyStatus && <span className="text-xs text-green-600 font-medium">{copyStatus}</span>}
              </>
            )}
          </div>
          <button onClick={onClose} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">닫기</button>
        </div>
      </div>
    </div>
  );
}
