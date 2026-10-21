'use client';

import { useEffect } from 'react';

/**
 * Sets the browser tab's title while the calling page is shown, and puts the previous one back when
 * it goes. The print reports use it so "Save as PDF" proposes a file name per report (the root
 * layout's metadata title is the same on every route).
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
