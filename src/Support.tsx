export const feedbackEmail = 'cypresun2003@gmail.com';
export const feedbackHref = 'mailto:' + feedbackEmail + '?subject=' + encodeURIComponent('第二视角 · 反馈与改进');
export function SupportLink({ children = '联系支持' }: { children?: React.ReactNode }) {
  return <a className="text-button support-link" href={feedbackHref}>{children}</a>;
}
export function ServiceUnavailable() {
  return <p className="service-unavailable" role="status">分析服务暂不可用，你的输入已保留。<SupportLink /></p>;
}
