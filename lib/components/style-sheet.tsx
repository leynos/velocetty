/** @file Injects global scrollbar styles based on theme colours. */
import type React from 'react';
import {forwardRef} from 'react';

import type {StyleSheetProps} from '../../typings/hyper';

const StyleSheet = forwardRef(function StyleSheet(props: StyleSheetProps, ref: React.ForwardedRef<HTMLStyleElement>) {
  const {borderColor} = props;

  return (
    <style jsx="true" global="true" ref={ref}>{`
      ::-webkit-scrollbar {
        width: 5px;
      }
      ::-webkit-scrollbar-thumb {
        -webkit-border-radius: 10px;
        border-radius: 10px;
        background: ${borderColor};
      }
      ::-webkit-scrollbar-thumb:window-inactive {
        background: ${borderColor};
      }
    `}</style>
  );
});

StyleSheet.displayName = 'StyleSheet';

export default StyleSheet;
