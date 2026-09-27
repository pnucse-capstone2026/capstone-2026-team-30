/**
 * CSV 파일 변환 및 다운로드를 처리하는 유틸리티
 */

export interface CSVHeader<T> {
  key: keyof T | ((item: T) => string | number | boolean | null | undefined);
  label: string;
}

/**
 * 객체 배열을 CSV 포맷으로 변환하고 브라우저 다운로드를 트리거합니다.
 * 한글 깨짐을 방지하기 위해 UTF-8 BOM(\uFEFF)을 포함합니다.
 */
export function exportToCSV<T extends Record<string, any>>(
  filename: string,
  headers: CSVHeader<T>[],
  data: T[],
): void {
  if (!data || data.length === 0) {
    return;
  }

  // 1. 헤더 행 생성
  const headerRow = headers.map((h) => `"${escapeCSV(h.label)}"`).join(",");

  // 2. 데이터 행 생성
  const dataRows = data.map((item) => {
    return headers
      .map((h) => {
        let value: any;
        if (typeof h.key === "function") {
          value = h.key(item);
        } else {
          value = item[h.key];
        }

        if (value === null || value === undefined) {
          value = "";
        } else {
          value = String(value);
        }

        return `"${escapeCSV(value)}"`;
      })
      .join(",");
  });

  // 3. BOM 포함 CSV 문자열 작성
  const csvContent = "\uFEFF" + [headerRow, ...dataRows].join("\r\n");

  // 4. Blob 생성 및 다운로드 링크 클릭
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * CSV 필드 내 따옴표 및 특수문자 이스케이프 처리
 */
function escapeCSV(val: string): string {
  return val.replace(/"/g, '""');
}
