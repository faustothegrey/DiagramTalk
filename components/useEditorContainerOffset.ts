'use client'

import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'

type ContainerOffset = {
  left: number
  top: number
}

export function useEditorContainerOffset(editor: Editor) {
  const [offset, setOffset] = useState<ContainerOffset>({ left: 0, top: 0 })

  useEffect(() => {
    const container = editor.getContainer()

    const updateOffset = () => {
      const rect = container.getBoundingClientRect()
      setOffset((current) => {
        if (current.left === rect.left && current.top === rect.top) return current
        return { left: rect.left, top: rect.top }
      })
    }

    updateOffset()

    const resizeObserver = new ResizeObserver(updateOffset)
    resizeObserver.observe(container)
    window.addEventListener('resize', updateOffset)
    window.addEventListener('scroll', updateOffset, true)

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateOffset)
      window.removeEventListener('scroll', updateOffset, true)
    }
  }, [editor])

  return offset
}
