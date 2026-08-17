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
