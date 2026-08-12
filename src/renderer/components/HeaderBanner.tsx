type HeaderBannerProps = {
  message?: string;
};

export const HeaderBanner = ({ message }: HeaderBannerProps) => {
  if (!message) {
    return null;
  }

  return <div className="header-banner">{message}</div>;
};
