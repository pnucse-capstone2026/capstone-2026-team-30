import { ApiProperty } from "@nestjs/swagger";

export class HardwareTierPresetDto {
  @ApiProperty({ example: "CPU_SMALL" })
  id: string;

  @ApiProperty({ example: "Small CPU (1 Core / 2GB RAM)" })
  name: string;

  @ApiProperty({ example: "0.5" })
  cpuRequest: string;

  @ApiProperty({ example: "1.0" })
  cpuLimit: string;

  @ApiProperty({ example: "1Gi" })
  memoryRequest: string;

  @ApiProperty({ example: "2Gi" })
  memoryLimit: string;

  @ApiProperty({ example: "0" })
  gpuLimit: string;

  @ApiProperty({ example: false })
  isGpuRequired: boolean;

  @ApiProperty({
    example: true,
    description: "현재 클러스터 환경에서 프로비저닝 가능 여부",
  })
  isAvailable?: boolean;

  @ApiProperty({
    example:
      "현재 클러스터에 GPU 노드가 없어 지원되지 않습니다 (프리티어/CPU 전용)",
    required: false,
    description: "비활성화 사유",
  })
  disabledReason?: string;
}

export class FrameworkImagePresetDto {
  @ApiProperty({ example: "JUPYTER_PYTORCH" })
  id: string;

  @ApiProperty({ example: "PyTorch 2.1 + JupyterLab" })
  name: string;

  @ApiProperty({ example: "kubeflownotebookswg/jupyter-pytorch-full:v1.8.0" })
  image: string;

  @ApiProperty({ example: "JupyterLab" })
  type: "JupyterLab" | "RStudio" | "VSCode";
}

export class NotebookPresetsResponseDto {
  @ApiProperty({ type: [HardwareTierPresetDto] })
  hardwareTiers: HardwareTierPresetDto[];

  @ApiProperty({ type: [FrameworkImagePresetDto] })
  frameworkImages: FrameworkImagePresetDto[];
}
