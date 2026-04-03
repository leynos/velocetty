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

const KEYBOARD_RESIZE_STEP = 0.05;
const KEYBOARD_PAGE_RESIZE_STEP = 0.1;

const resizeAdjacentPanes = (sizes: number[], index: number, nextLeadingPaneSize: number) => {
  const nextSizes = [...sizes];
  const pairTotal = sizes[index] + sizes[index + 1];
  const clampedLeadingPaneSize = Math.min(Math.max(nextLeadingPaneSize, 0), pairTotal);

  nextSizes[index] = clampedLeadingPaneSize;
  nextSizes[index + 1] = pairTotal - clampedLeadingPaneSize;

  return nextSizes;
};

const SplitPane = forwardRef(function SplitPane(props: SplitPaneProps, ref: React.ForwardedRef<HTMLDivElement>) {
  const dragPanePosition = useRef<number>(0);
  const dragOffset = useRef<number>(0);
  const dragTarget = useRef<HTMLElement | null>(null);
  const paneIndex = useRef<number>(0);
  const dragPointerAxisRef = useRef<'clientX' | 'clientY'>(props.direction === 'horizontal' ? 'clientY' : 'clientX');
  const dragD1Ref = useRef<'height' | 'width'>(props.direction === 'horizontal' ? 'height' : 'width');
  const dragD2Ref = useRef<'top' | 'left'>(props.direction === 'horizontal' ? 'top' : 'left');
  const dragStartPointerRef = useRef<number>(0);
  const panesSize = useRef<number[] | null>(null);
  const paneContainerSize = useRef<number | null>(null);
  const lastEmittedSizesRef = useRef<number[] | null>(null);
  const [dragging, setDragging] = useState(false);

  // Use a ref to access latest props without recreating callbacks during drag
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  const handleAutoResize = (ev: React.MouseEvent<HTMLElement>, index: number) => {
    ev.preventDefault();

    paneIndex.current = index;

    const sizes_ = getSizes();
    sizes_[paneIndex.current] = 0;
    sizes_[paneIndex.current + 1] = 0;

    const availableWidth = 1 - sum(sizes_);
    sizes_[paneIndex.current] = availableWidth / 2;
    sizes_[paneIndex.current + 1] = availableWidth / 2;

    propsRef.current.onResize(sizes_);
  };

  const handleDragStart = (ev: React.MouseEvent<HTMLElement>, index: number) => {
    ev.preventDefault();
    const target = ev.currentTarget;
    const parent = target.parentElement;
    if (!parent) {
      return;
    }
    setDragging(true);
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('mouseup', onDragEnd);
    dragTarget.current = target;
    dragPointerAxisRef.current = propsRef.current.direction === 'horizontal' ? 'clientY' : 'clientX';
    dragD1Ref.current = propsRef.current.direction === 'horizontal' ? 'height' : 'width';
    dragD2Ref.current = propsRef.current.direction === 'horizontal' ? 'top' : 'left';
    dragStartPointerRef.current = ev[dragPointerAxisRef.current];
    const dividerRect = dragTarget.current.getBoundingClientRect();
    dragPanePosition.current = dragStartPointerRef.current;
    dragOffset.current = dragStartPointerRef.current - dividerRect[dragD2Ref.current];
    paneIndex.current = index;
    panesSize.current = getSizes();
    paneContainerSize.current = parent.getBoundingClientRect()[dragD1Ref.current];
    lastEmittedSizesRef.current = getSizes();
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

  const resizePanePair = useCallback(
    (index: number, nextLeadingPaneSize: number) => {
      const sizes_ = getSizes();
      const nextSizes = resizeAdjacentPanes(sizes_, index, nextLeadingPaneSize);
      if (nextSizes.every((size, nextIndex) => size === sizes_[nextIndex])) {
        return;
      }

      propsRef.current.onResize(nextSizes);
    },
    [getSizes]
  );

  const onDrag = useCallback((ev: MouseEvent) => {
    if (!panesSize.current || !paneContainerSize.current) {
      return;
    }
    const sizes_ = [...panesSize.current];

    const axis = dragPointerAxisRef.current;
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
    dragTarget.current?.style.setProperty(dragD2Ref.current, `${dividerPosition}px`);
    if (lastEmittedSizesRef.current && sizes_.every((size, index) => size === lastEmittedSizesRef.current?.[index])) {
      return;
    }

    lastEmittedSizesRef.current = [...sizes_];
    propsRef.current.onResize(sizes_);
  }, []);

  const onDragEnd = useCallback(() => {
    window.removeEventListener('mousemove', onDrag);
    window.removeEventListener('mouseup', onDragEnd);
    dragTarget.current?.style.removeProperty('left');
    dragTarget.current?.style.removeProperty('top');
    dragTarget.current = null;
    panesSize.current = null;
    paneContainerSize.current = null;
    dragOffset.current = 0;
    lastEmittedSizesRef.current = null;
    setDragging(false);
  }, [onDrag]);

  useEffect(() => {
    return () => {
      onDragEnd();
    };
  }, [onDragEnd]);

  const handleKeyResize = (event: React.KeyboardEvent<HTMLElement>, index: number) => {
    const sizes_ = getSizes();
    const currentLeadingPaneSize = sizes_[index];
    const pairTotal = currentLeadingPaneSize + sizes_[index + 1];
    const isVerticalDivider = propsRef.current.direction === 'vertical';
    let nextLeadingPaneSize: number | null = null;

    switch (event.key) {
      case 'ArrowLeft':
        if (isVerticalDivider) {
          nextLeadingPaneSize = currentLeadingPaneSize - KEYBOARD_RESIZE_STEP;
        }
        break;
      case 'ArrowRight':
        if (isVerticalDivider) {
          nextLeadingPaneSize = currentLeadingPaneSize + KEYBOARD_RESIZE_STEP;
        }
        break;
      case 'ArrowUp':
        if (!isVerticalDivider) {
          nextLeadingPaneSize = currentLeadingPaneSize - KEYBOARD_RESIZE_STEP;
        }
        break;
      case 'ArrowDown':
        if (!isVerticalDivider) {
          nextLeadingPaneSize = currentLeadingPaneSize + KEYBOARD_RESIZE_STEP;
        }
        break;
      case 'PageUp':
        nextLeadingPaneSize = currentLeadingPaneSize - KEYBOARD_PAGE_RESIZE_STEP;
        break;
      case 'PageDown':
        nextLeadingPaneSize = currentLeadingPaneSize + KEYBOARD_PAGE_RESIZE_STEP;
        break;
      case 'Home':
        nextLeadingPaneSize = 0;
        break;
      case 'End':
        nextLeadingPaneSize = pairTotal;
        break;
      default:
        break;
    }

    if (nextLeadingPaneSize === null) {
      return;
    }

    event.preventDefault();
    resizePanePair(index, nextLeadingPaneSize);
  };

  const {children, direction, borderColor} = props;
  const sizeProperty = direction === 'horizontal' ? 'height' : 'width';
  const separatorOrientation = direction === 'vertical' ? 'vertical' : 'horizontal';
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
              <hr
                onMouseDown={(e) => handleDragStart(e, i)}
                onDoubleClick={(e) => handleAutoResize(e, i)}
                onKeyDown={(event) => handleKeyResize(event, i)}
                tabIndex={0}
                aria-label="Resize panes"
                aria-orientation={separatorOrientation}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(sizes[i] * 100)}
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
