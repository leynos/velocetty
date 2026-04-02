/** @file Injects global scrollbar styles based on theme colours. */
import type React from 'react';
import {forwardRef} from 'react';

import type {StyleSheetProps} from '../../typings/hyper';
import * as styles from './style-sheet.module.css';

const StyleSheet = forwardRef(function StyleSheet(props: StyleSheetProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const {borderColor, className} = props;

  return (
    <div
      ref={ref}
      className={`${styles.host} ${className ?? ''}`}
      style={{'--scrollbar-thumb': borderColor} as React.CSSProperties}
    />
  );
});

StyleSheet.displayName = 'StyleSheet';

export default StyleSheet;
