import { useId, useMemo } from 'react';
import { neutralAdjustments, saturationMatrix, type ImageAdjustments } from './core/image-adjustments';

/** Native SVG channel transfers provide real gamma correction without a JS frame loop. */
export function useImageAdjustmentFilter(a: ImageAdjustments) {
  const id = `image-adjustments-${useId().replaceAll(':', '')}`;
  return useMemo(() => {
    if (neutralAdjustments(a)) return { filter: 'none', definitions: null };
    return {
    filter: `url("#${id}")`,
    definitions: <svg className="image-adjustment-definitions" aria-hidden="true" width="0" height="0">
      <defs><filter id={id} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feComponentTransfer in="SourceGraphic" result="brightness">
          <feFuncR type="linear" slope={a.brightness / 100} /><feFuncG type="linear" slope={a.brightness / 100} /><feFuncB type="linear" slope={a.brightness / 100} />
        </feComponentTransfer>
        <feComponentTransfer in="brightness" result="contrast">
          <feFuncR type="linear" slope={a.contrast / 100} intercept={0.5 - a.contrast / 200} />
          <feFuncG type="linear" slope={a.contrast / 100} intercept={0.5 - a.contrast / 200} />
          <feFuncB type="linear" slope={a.contrast / 100} intercept={0.5 - a.contrast / 200} />
        </feComponentTransfer>
        <feColorMatrix in="contrast" type="matrix" values={saturationMatrix(a.saturation)} result="saturation" />
        <feComponentTransfer in="saturation">
          <feFuncR type="gamma" amplitude="1" exponent={1 / a.gamma} offset="0" />
          <feFuncG type="gamma" amplitude="1" exponent={1 / a.gamma} offset="0" />
          <feFuncB type="gamma" amplitude="1" exponent={1 / a.gamma} offset="0" />
        </feComponentTransfer>
      </filter></defs>
    </svg>,
    };
  }, [id, a.brightness, a.contrast, a.saturation, a.gamma]);
}
