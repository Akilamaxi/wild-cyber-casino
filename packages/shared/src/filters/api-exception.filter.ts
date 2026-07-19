import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = request.requestId || request.headers['x-correlation-id'] || uuidv4();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: any = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null) {
        message = (res as any).message || exception.message;
        details = (res as any).error || res;
      } else {
        message = exception.message;
      }
    } else if (exception && exception.message) {
      // Handle custom domain exceptions or generic errors
      message = exception.message;
      if (exception.status) {
         status = exception.status;
      } else {
         // Naive mapping based on common domain error keywords
         if (message.toLowerCase().includes('not found')) status = HttpStatus.NOT_FOUND;
         else if (message.toLowerCase().includes('insufficient')) status = HttpStatus.UNPROCESSABLE_ENTITY;
         else if (message.toLowerCase().includes('unauthorized') || message.toLowerCase().includes('invalid token')) status = HttpStatus.UNAUTHORIZED;
         else if (message.toLowerCase().includes('forbidden') || message.toLowerCase().includes('banned')) status = HttpStatus.FORBIDDEN;
         else status = HttpStatus.BAD_REQUEST; // Default to 400 for domain errors
      }
    }

    // Console log for debugging
    if (status >= 500) {
      console.error(`[ApiExceptionFilter] ${correlationId} -`, exception);
    }

    response.status(status).json({
      success: false,
      code: status,
      message,
      details,
      correlationId,
    });
  }
}
