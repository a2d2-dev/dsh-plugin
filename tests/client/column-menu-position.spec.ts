import { expect, it } from 'vitest'
import { columnMenuPosition } from '../../src/client/column-menu-position.ts'

it.each([
  {width:1600,height:1000,left:1490,bottom:900},
  {width:390,height:844,left:78,bottom:423},
  {width:280,height:320,left:700,bottom:900},
])('keeps menus with arbitrarily tall contents inside $width × $height',({width,height,left,bottom})=>{
  const position=columnMenuPosition({left,bottom},{width,height})
  expect(position.left).toBeGreaterThanOrEqual(8)
  expect(position.left+Math.min(304,width-16)).toBeLessThanOrEqual(width-8)
  expect(position.top).toBeGreaterThanOrEqual(8)
  expect(position.maxHeight).toBeGreaterThan(0)
  expect(position.top+position.maxHeight).toBeLessThanOrEqual(height-8)
})
