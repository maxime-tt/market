import type { ComponentPropsWithoutRef } from 'react'
import type { Button } from '../wrappers/button'

/** Helper type to extract "ButtonProps" type from the project Button wrapper */
export type ButtonProps = ComponentPropsWithoutRef<typeof Button>

/** Helper type to use valid string values for Button Variants */
export type ButtonVariant = 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
