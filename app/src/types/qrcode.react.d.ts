declare module 'qrcode.react' {
  import React from 'react';

  interface QRCodeProps {
    value: string;
    size?: number;
    level?: 'L' | 'M' | 'Q' | 'H';
    includeMargin?: boolean;
    renderAs?: 'canvas' | 'svg';
    fgColor?: string;
    bgColor?: string;
    quietZone?: number;
    id?: string;
    className?: string;
    imageSettings?: {
      src: string;
      x?: number;
      y?: number;
      height: number;
      width: number;
      excavate?: boolean;
    };
  }

  const QRCode: React.FC<QRCodeProps>;
  export default QRCode;
}
