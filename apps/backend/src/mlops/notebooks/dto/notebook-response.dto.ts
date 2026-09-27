import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export type NotebookStateStatus = "Running" | "Stopped" | "Pending" | "Failed";

export class NotebookResponseDto {
  @ApiProperty({ example: "analysis-workspace-01" })
  name: string;

  @ApiProperty({ example: "default" })
  namespace: string;

  @ApiProperty({ example: "cluster-us-east-1a" })
  clusterId: string;

  @ApiProperty({
    example: "Running",
    enum: ["Running", "Stopped", "Pending", "Failed"],
  })
  status: NotebookStateStatus;

  @ApiProperty({ example: "kubeflownotebookswg/jupyter-pytorch-full:v1.8.0" })
  image: string;

  @ApiProperty({ example: "CPU_MEDIUM" })
  hardwareTier: string;

  @ApiProperty({ example: "2" })
  cpuLimit: string;

  @ApiProperty({ example: "4Gi" })
  memoryLimit: string;

  @ApiProperty({ example: "0" })
  gpuLimit: string;

  @ApiPropertyOptional({
    example:
      "https://notebooks.example.com/notebook/default/analysis-workspace-01/",
  })
  url?: string;

  @ApiPropertyOptional({ example: "2026-08-25T14:00:00Z" })
  createdAt?: string;
}
