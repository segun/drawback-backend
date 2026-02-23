import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  getHealth(): { name: string; status: string } {
    return {
      name: 'DrawkcaB backend',
      status: 'ok',
    };
  }
}
