/**
 * 정책 오류 처리 기준(Processing Standards) 관련 데이터 구조, 타입 정의 및 확장성 레지스트리
 *
 * 디자인 패턴: Standard Section Registry & Composite Config Strategy
 * 추후 새로운 설정 그룹(예: 웹훅 알림, 승인 워크플로우 등)이 추가되더라도
 * 기존 코드를 변경하지 않고 새로운 레지스트리 항목 추가만으로 확장 가능하도록 설계되었습니다.
 */

// 1. 심각도별 SLA 기한 설정 (시간 단위)
export interface SLACriteria {
  criticalHours: number;
  highHours: number;
  mediumHours: number;
  lowHours: number;
}

// 2. 조직/담당자 할당 규칙 설정
export interface AssignmentCriteria {
  defaultAssigneeGroup: string;
  autoAssignByNamespace: boolean;
}

// 3. 전체 처리 기준 설정 (Composite Config)
// 추후 [key: string]: unknown 또는 새로운 섹션을 손쉽게 추가 가능
export interface ProcessingStandardsConfig {
  sla: SLACriteria;
  assignment: AssignmentCriteria;
  // 향후 확장용 동적 메타데이터/추가 설정 레지스트리
  extraSettings?: Record<string, unknown>;
}

/**
 * 기본 처리 기준 설정 값
 */
export const DEFAULT_PROCESSING_STANDARDS: ProcessingStandardsConfig = {
  sla: {
    criticalHours: 24,
    highHours: 48,
    mediumHours: 72,
    lowHours: 168, // 7일
  },
  assignment: {
    defaultAssigneeGroup: "SecOps Team",
    autoAssignByNamespace: true,
  },
};

/**
 * LocalStorage 키 명칭
 */
export const PROCESSING_STANDARDS_STORAGE_KEY =
  "kyverno_processing_standards_v1";

/**
 * 저장소에서 처리 기준 설정 로드
 */
export function loadProcessingStandards(): ProcessingStandardsConfig {
  if (typeof window === "undefined") {
    return DEFAULT_PROCESSING_STANDARDS;
  }
  try {
    const stored = localStorage.getItem(PROCESSING_STANDARDS_STORAGE_KEY);
    if (!stored) return DEFAULT_PROCESSING_STANDARDS;
    const parsed = JSON.parse(stored);
    return {
      ...DEFAULT_PROCESSING_STANDARDS,
      ...parsed,
      sla: { ...DEFAULT_PROCESSING_STANDARDS.sla, ...parsed.sla },
      assignment: {
        ...DEFAULT_PROCESSING_STANDARDS.assignment,
        ...parsed.assignment,
      },
    };
  } catch {
    return DEFAULT_PROCESSING_STANDARDS;
  }
}

/**
 * 저장소에 처리 기준 설정 저장
 */
export function saveProcessingStandards(
  config: ProcessingStandardsConfig,
): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      PROCESSING_STANDARDS_STORAGE_KEY,
      JSON.stringify(config),
    );
  } catch (error) {
    console.error("Failed to save processing standards:", error);
  }
}

/**
 * [확장성 디자인 패턴]
 * 메타데이터 레지스트리 - 폼 UI 및 카테고리를 동적으로 확장할 수 있도록 정의
 */
export interface StandardFieldDefinition<T> {
  key: keyof T;
  label: string;
  description?: string;
  type: "number" | "boolean" | "select" | "text";
  options?: Array<{ label: string; value: string | number }>;
  unit?: string;
}

export const SLA_FIELD_DEFINITIONS: StandardFieldDefinition<SLACriteria>[] = [
  {
    key: "criticalHours",
    label: "긴급 (Critical) SLA",
    description: "긴급 오류 발생 후 대응 완료 권장 시간",
    type: "number",
    unit: "시간",
  },
  {
    key: "highHours",
    label: "높음 (High) SLA",
    description: "높음 심각도 대응 권장 시간",
    type: "number",
    unit: "시간",
  },
  {
    key: "mediumHours",
    label: "중간 (Medium) SLA",
    description: "중간 심각도 대응 권장 시간",
    type: "number",
    unit: "시간",
  },
  {
    key: "lowHours",
    label: "낮음 (Low) SLA",
    description: "낮음 심각도 대응 권장 시간",
    type: "number",
    unit: "시간",
  },
];
