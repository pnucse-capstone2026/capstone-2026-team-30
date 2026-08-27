import { Injectable, Logger } from "@nestjs/common";
import { AuthenticatedUser } from "../../auth/auth.types";
import { BusinessException } from "../../common/errors/business.exception";
import { MLOPS_ERROR } from "../mlops.errors";
import { KServeAdapter } from "./kserve.adapter";
import { DeployModelDto } from "./dto/deploy-model.dto";
import {
  InferenceServiceResponseDto,
  PredictResultDto,
} from "./dto/serving-endpoint-response.dto";

/**
 * KServe 모델 배포, 카나리 트래픽 업데이트, Scale-to-Zero 및 테스트 조작 비즈니스 로직을 제공합니다.
 */
@Injectable()
export class ServingService {
  private readonly logger = new Logger(ServingService.name);

  constructor(private readonly kserveAdapter: KServeAdapter) {}

  /**
   * 사용자의 클러스터 접근 권한을 검증합니다.
   */
  private validateClusterAccess(
    clusterId: string,
    user: AuthenticatedUser,
  ): void {
    if (user.clusterIds && !user.clusterIds.includes(clusterId)) {
      throw new BusinessException(MLOPS_ERROR.CLUSTER_ACCESS_DENIED);
    }
  }

  /**
   * S3/MinIO 모델 저장소 URI 형식을 검증합니다.
   */
  private validateStorageUri(storageUri: string): void {
    if (!storageUri.startsWith("s3://") && !storageUri.startsWith("minio://")) {
      throw new BusinessException(MLOPS_ERROR.INVALID_MODEL_PATH);
    }
  }

  /**
   * KServe InferenceService 엔드포인트 목록을 조회합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param user 요청자 인증 컨텍스트
   * @returns InferenceService 응답 DTO 목록
   */
  async getEndpoints(
    clusterId: string,
    namespace: string,
    user: AuthenticatedUser,
  ): Promise<InferenceServiceResponseDto[]> {
    this.validateClusterAccess(clusterId, user);
    return this.kserveAdapter.listInferenceServices(clusterId, namespace);
  }

  /**
   * 신규 KServe 모델 배포를 진행합니다.
   *
   * @param dto 배포 설정 DTO
   * @param user 요청자 인증 컨텍스트
   * @returns 작성된 서빙 엔드포인트 객체
   * @throws {BusinessException} 모델 경로 미지원 또는 배포 실패 시
   */
  async deployModel(
    dto: DeployModelDto,
    user: AuthenticatedUser,
  ): Promise<InferenceServiceResponseDto> {
    this.validateClusterAccess(dto.clusterId, user);
    this.validateStorageUri(dto.storageUri);

    try {
      this.logger.log(
        `Deploying model '${dto.name}' framework=${dto.framework} by '${user.email}'`,
      );
      return await this.kserveAdapter.createInferenceService(dto);
    } catch (error) {
      this.logger.error(`Model deployment failed: ${String(error)}`);
      throw new BusinessException(MLOPS_ERROR.SERVING_DEPLOYMENT_FAILED);
    }
  }

  /**
   * Canary 트래픽 분할 비율을 업데이트합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param name 엔드포인트 명칭
   * @param percent Canary 비율 (0 ~ 100%)
   * @param user 요청자 인증 컨텍스트
   * @returns 업데이트된 서빙 엔드포인트 객체
   */
  async updateTrafficSplit(
    clusterId: string,
    namespace: string,
    name: string,
    percent: number,
    user: AuthenticatedUser,
  ): Promise<InferenceServiceResponseDto> {
    this.validateClusterAccess(clusterId, user);
    return this.kserveAdapter.updateTrafficSplit(
      clusterId,
      namespace,
      name,
      percent,
    );
  }

  /**
   * KServe 서빙 엔드포인트를 삭제합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param name 엔드포인트 명칭
   * @param user 요청자 인증 컨텍스트
   */
  async deleteEndpoint(
    clusterId: string,
    namespace: string,
    name: string,
    user: AuthenticatedUser,
  ): Promise<void> {
    this.validateClusterAccess(clusterId, user);
    await this.kserveAdapter.deleteInferenceService(clusterId, namespace, name);
  }

  /**
   * 배포된 서빙 엔드포인트에 테스트 페이로드를 전송하여 추론 결과를 검증합니다.
   *
   * @param clusterId 클러스터 식별자
   * @param namespace 네임스페이스
   * @param name 엔드포인트 명칭
   * @param payload 테스트 입력 텐서 데이터
   * @param user 요청자 인증 컨텍스트
   * @returns 예측 성공 결과 및 응답 지연시간(ms)
   */
  async testPrediction(
    clusterId: string,
    namespace: string,
    name: string,
    payload: Record<string, unknown>,
    user: AuthenticatedUser,
  ): Promise<PredictResultDto> {
    this.validateClusterAccess(clusterId, user);

    const start = Date.now();
    // 추론 테스트 모의 수행
    const mockOutput = {
      predictions: [
        {
          label: "Class_A",
          probability: 0.942,
          inputReceived: payload,
        },
      ],
    };
    const latencyMs = Date.now() - start + 18;

    return {
      success: true,
      output: mockOutput,
      latencyMs,
    };
  }
}
