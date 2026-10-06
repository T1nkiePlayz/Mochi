type MochiLogoProps = {
  size?: number;
  className?: string;
};

export function MochiLogo({ size = 32, className = "" }: MochiLogoProps) {
  return (
    <svg
      aria-label="Mochi logo"
      className={className}
      height={size}
      role="img"
      viewBox="0 0 40 40"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="mochi-logo-fill" x1="8" x2="32" y1="5" y2="36" gradientUnits="userSpaceOnUse">
          <stop stopColor="#E8F0E7" />
          <stop offset="1" stopColor="#A9C9BD" />
        </linearGradient>
      </defs>
      <path
        d="M20 3.5c8.8 0 15.8 5.9 15.8 14.8 0 2.2-.3 4.1-1.1 5.9 1.1 1.9.9 5.2-.9 7.2-1.8 2-4.3 2.1-6.5 1.3-2.1 1.2-4.5 1.8-7.3 1.8-2.8 0-5.3-.6-7.3-1.8-2.2.8-4.7.7-6.5-1.3-1.8-2-2-5.3-.9-7.2-.8-1.8-1.1-3.7-1.1-5.9C4.2 9.4 11.2 3.5 20 3.5Z"
        fill="url(#mochi-logo-fill)"
      />
      <path d="M12.7 18.3a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM27.3 18.3a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" fill="#253A3B" />
      <path d="M15.5 23.7c1.1 2.2 2.7 3.3 4.5 3.3s3.4-1.1 4.5-3.3" fill="none" stroke="#253A3B" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M28.3 7.2c2.4.9 4.1 2.4 5.5 4.6" fill="none" stroke="#F0B4A6" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}
