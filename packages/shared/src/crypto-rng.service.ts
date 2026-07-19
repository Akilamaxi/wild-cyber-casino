import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class CryptoRngService {
  generateDrawNumbers(lotteryName: string, drawId: number, salt: string) {
    const seedSuffix = crypto.randomBytes(16).toString('hex');
    const combinedSeed = `${lotteryName}-${drawId}-${salt}-${seedSuffix}`;
    
    const drawNumbers: number[] = [];
    let ballIndex = 1;
    let retryIndex = 0;

    while (drawNumbers.length < 6) {
      const inputString = `${combinedSeed}-ball-${ballIndex}${retryIndex > 0 ? `-retry-${retryIndex}` : ''}`;
      const hash = crypto.createHmac('sha256', salt).update(inputString).digest('hex');
      const number = (parseInt(hash.substring(0, 12), 16) % 49) + 1;
      
      if (!drawNumbers.includes(number)) {
        drawNumbers.push(number);
        ballIndex++;
        retryIndex = 0;
      } else {
        retryIndex++;
      }
    }

    drawNumbers.sort((a, b) => a - b);
    const masterHash = crypto.createHmac('sha256', salt).update(combinedSeed).digest('hex');

    return {
      winningNumbers: drawNumbers,
      seed: combinedSeed,
      hash: masterHash
    };
  }

  verifyDrawNumbers(combinedSeed: string, salt: string, winningNumbers: number[]): boolean {
    const drawNumbers: number[] = [];
    let ballIndex = 1;
    let retryIndex = 0;

    while (drawNumbers.length < 6) {
      const inputString = `${combinedSeed}-ball-${ballIndex}${retryIndex > 0 ? `-retry-${retryIndex}` : ''}`;
      const hash = crypto.createHmac('sha256', salt).update(inputString).digest('hex');
      const number = (parseInt(hash.substring(0, 12), 16) % 49) + 1;
      
      if (!drawNumbers.includes(number)) {
        drawNumbers.push(number);
        ballIndex++;
        retryIndex = 0;
      } else {
        retryIndex++;
      }
    }
    drawNumbers.sort((a, b) => a - b);

    if (drawNumbers.length !== winningNumbers.length) return false;
    return drawNumbers.every((val, index) => val === winningNumbers[index]);
  }
}
