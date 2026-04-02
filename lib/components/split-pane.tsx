/**
 * @file Renders the `SplitPane` component used by
 * `lib/components/term-group.tsx` to size sibling panes in horizontal and
 * vertical term layouts.
 *
 * Responsibilities:
 * - Preserve the total size of the two panes adjacent to a divider during
 *   drag and double-click resize operations.
 * - Honour the `direction`, `sizes`, `borderColor`, and `onResize` props that
 *   define the caller contract for pane layout and resize feedback.
 *
 * Resize invariants:
 * - Keep emitted pane sizes within the inclusive `[0, 1]` range.
 * - Preserve the combined size of the two panes beside the active divider.
 * - Clamp drag deltas when either pane reaches its minimum size of `0`.
 * - Keep panes outside the active divider fixed while only the adjacent pair
 *   flexes during a resize gesture.
 */

import React, {useState, useEffect, useRef, useCallback, forwardRef} from 'react';

import sum from 'lodash/sum';

import type {SplitPaneProps} from '../../typings/hyper';
import * as styles from './split-pane.module.css';

const SplitPane = forwardRef(function SplitPane(props: SplitPaneProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const dragPanePosition = useRef<number>(0);
  const dragOffset = useRef<number>(0);
  const dragTarget = useRef<HTMLDivElement | null>(null);
  const paneIndex = useRef<number>(0);
  const d1 = props.direction === 'horizontal' ? 'height' : 'width';
  const d2 = props.direction === 'horizontal' ? 'top' : 'left';
  const panesSize = useRef<number[] | null>(null);
  const paneContainerSize = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false);

  // Use a ref to access latest props without recreating callbacks during drag
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

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
    const pointerAxis = propsRef.current.direction === 'horizontal' ? 'clientY' : 'clientX';
    const pointer = ev[pointerAxis];
    const dividerRect = dragTarget.current.getBoundingClientRect();
    dragPanePosition.current = pointer;
    dragOffset.current = pointer - dividerRect[d2];
    paneIndex.current = index;
    panesSize.current = getSizes();
    paneContainerSize.current = parent.getBoundingClientRect()[d1];
  };

  const getSizes = useCallback(() => {
    const {sizes} = propsRef.current;
    let sizes_: number[];

    if (sizes) {
      sizes_ = [...sizes.asMutable()];
    } else {
      const total = propsRef.current.children.length;
      const count = new Array<number>(total).fill(1 / total);

      sizes_ = count;
    }
    return sizes_;
  }, []);

  const onDrag = useCallback(
    (ev: MouseEvent) => {
      if (!panesSize.current || !paneContainerSize.current) {
        return;
      }
      const sizes_ = [...panesSize.current];

      // Read direction from propsRef to avoid stale closure during drag
      const axis = propsRef.current.direction === 'horizontal' ? 'clientY' : 'clientX';
      const i = paneIndex.current;
      const pointer = ev[axis];
      const dividerPosition = pointer - dragOffset.current;
      const d = Math.abs(dragPanePosition.current - pointer) / paneContainerSize.current;
      if (pointer > dragPanePosition.current) {
        const clampedDelta = Math.min(d, sizes_[i + 1]);
        sizes_[i] += clampedDelta;
        sizes_[i + 1] -= clampedDelta;
      } else {
        const clampedDelta = Math.min(d, sizes_[i]);
        sizes_[i] -= clampedDelta;
        sizes_[i + 1] += clampedDelta;
      }
      dragTarget.current?.style.setProperty(d2, `${dividerPosition}px`);
      propsRef.current.onResize(sizes_);
    },
    [getSizes]
  );

  const onDragEnd = useCallback(() => {
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', onDragEnd);
    panesSize.current = null;
    paneContainerSize.current = null;
    dragOffset.current = 0;
    setDragging(false);
  }, [onDrag]);

  useEffect(() => {
    return () => {
      onDragEnd();
    };
  }, [onDragEnd]);

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
