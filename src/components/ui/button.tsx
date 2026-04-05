import { cn } from '@/lib/utils';
import { forwardRef, type ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
}

const variantStyles = {
  default: 'am-btn-default',
  primary: 'am-btn-primary',
  secondary: 'am-btn-secondary',
  ghost: 'am-btn-ghost',
  danger: 'am-btn-danger',
};

const sizeStyles = {
  sm: 'min-h-11 min-w-11 px-3 py-1.5 text-sm',
  md: 'min-h-11 min-w-11 px-4 py-2 text-base',
  lg: 'min-h-12 min-w-12 px-6 py-3 text-lg',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'am-btn am-touch-target touch-manipulation rounded-lg font-medium transition-colors duration-100 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed',
          variantStyles[variant],
          sizeStyles[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
