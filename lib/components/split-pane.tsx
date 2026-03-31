/** @file Resizable split pane container supporting horizontal and vertical layouts. */

import React, {useState, useEffect, useRef, forwardRef} from 'react';

import sum from 'lodash/sum';

import type {SplitPaneProps} from '../../typings/hyper';
import styles from './split-pane.module.css';

const SplitPane = forwardRef(function SplitPane(props: SplitPaneProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const dragPanePosition = useRef<number>(0);
  const dragTarget = useRef<HTMLDivElement | null>(null);
  const paneIndex = useRef<number>(0);
  const d1 = props.direction === 'horizontal' ? 'height' : 'width';
  const d2 = props.direction === 'horizontal' ? 'top' : 'left';
  const d3 = props.direction === 'horizontal' ? 'clientY' : 'clientX';
  const panesSize = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleAutoResize = (ev: React.MouseEvent<HTMLDivElement>, index: number) => {
    ev.preventDefault();

    paneIndex.current = index;

    const sizes_ = getSizes();
    sizes_[paneIndex.current] = 0;
    sizes_[paneIndex.current + 1] = 0;

    const availableWidth = 1 - sum(sizes_);
    sizes_[paneIndex.current] = availableWidth / 2;
    sizes_[paneIndex.current + 1] = availableWidth / 2;

    props.onResize(sizes_);
  };

  const handleDragStart = (ev: React.MouseEvent<HTMLDivElement>, index: number) => {
    ev.preventDefault();
    const target = ev.target as HTMLDivElement;
    const parent = target.parentElement;
    if (!parent) {
      return;
    }
    setDragging(true);
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', onDragEnd);
    dragTarget.current = target;
    dragPanePosition.current = dragTarget.current.getBoundingClientRect()[d2];
    panesSize.current = parent.getBoundingClientRect()[d1];
    paneIndex.current = index;
  };

  const getSizes = () => {
    const {sizes} = props;
    let sizes_: number[];

    if (sizes) {
      sizes_ = [...sizes.asMutable()];
    } else {
      const total = props.children.length;
      const count = new Array<number>(total).fill(1 / total);

      sizes_ = count;
    }
    return sizes_;
  };

  const onDrag = (ev: MouseEvent) => {
    if (!panesSize.current) {
      return;
    }
    const sizes_ = getSizes();

    const i = paneIndex.current;
    const pos = ev[d3];
    const d = Math.abs(dragPanePosition.current - pos) / panesSize.current!;
    if (pos > dragPanePosition.current) {
      sizes_[i] += d;
      sizes_[i + 1] -= d;
    } else {
      sizes_[i] -= d;
      sizes_[i + 1] += d;
    }
    props.onResize(sizes_);
  };

  const onDragEnd = () => {
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', onDragEnd);
    setDragging(false);
  };

  useEffect(() => {
    return () => {
      onDragEnd();
    };
  }, []);

  const {children, direction, borderColor} = props;
  const sizeProperty = direction === 'horizontal' ? 'height' : 'width';
  // workaround for the fact that if we don't specify
  // sizes, sometimes flex fails to calculate the
  // right height for the horizontal panes
  const sizes = props.sizes || new Array<number>(children.length).fill(1 / children.length);
  return (
    <div
      className={`${styles.splitpanePanes} ${direction === 'vertical' ? styles.splitpanePanesVertical : styles.splitpanePanesHorizontal}`}
      ref={ref}
    >
      {children.map((child, i) => {
        const style = {
          // flexBasis doesn't work for the first horizontal pane, height need to be specified
          [sizeProperty]: `${sizes[i] * 100}%`,
          flexBasis: `${sizes[i] * 100}%`,
          flexGrow: 0
        };

        return (
          <React.Fragment key={i}>
            <div className={styles.splitpanePane} style={style}>
              {child}
            </div>
            {i < children.length - 1 ? (
              <div
                onMouseDown={(e) => handleDragStart(e, i)}
                onDoubleClick={(e) => handleAutoResize(e, i)}
                style={{backgroundColor: borderColor}}
                className={`${styles.splitpaneDivider} ${direction === 'vertical' ? styles.splitpaneDividerVertical : styles.splitpaneDividerHorizontal}`}
              />
            ) : null}
          </React.Fragment>
        );
      })}
      <div style={{display: dragging ? 'block' : 'none'}} className={styles.splitpaneShim} />
    </div>
  );
});

SplitPane.displayName = 'SplitPane';

export default SplitPane;
