import { All, Controller, Next, Req, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request, Response, NextFunction } from "express";
import { NotebookProxyService } from "./notebook-proxy.service";

/**
 * Kubeflow Jupyter Notebook 웹 브라우저 접속 요청을 클러스터 내부 Service로 전달하는 프록시 컨트롤러입니다.
 */
@ApiExcludeController()
@Controller("notebook")
export class NotebookProxyController {
  constructor(private readonly proxyService: NotebookProxyService) {}

  @All()
  async handleRoot(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    return this.proxyService.handleHttp(req, res, next);
  }

  @All("*")
  async handleSubpaths(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    return this.proxyService.handleHttp(req, res, next);
  }
}
