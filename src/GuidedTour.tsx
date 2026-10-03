import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight, X } from 'lucide-react';

const steps = [
  { target: 'problem', title: '先说说你遇到的事', text: '上半区直接写问题、顾虑和目标。个人选择或工作决策，都从这里开始。' },
  { target: 'employees', title: '需要时，带上员工画像', text: '这是可选项。选择已有画像，或在这里新建并关联；不关联也可以分析。' },
  { target: 'plan', title: '先留下你自己的判断', text: '下半区必须填写初步决定，保留你的经验和判断。AI 生成的三个独立方案不会读取这段内容。' },
  { target: 'analyze', title: '看三个角度，再由你决定', text: '两处都写好后，点分析。核对发送内容后，三个 AI 方案会与你的初判一起展示，最终版本由你确认。' },
  { target: 'profile', title: '让建议了解你的背景', text: '圆形按钮里只需填写昵称、行业和一句话介绍。这里以弹窗打开，关闭后继续原来的输入。' },
  { target: 'team', title: '画像，由你的观察来写', text: '填写员工昵称、职责和一段主观看法。后续复盘中的画像修改，也必须经你确认。' },
  { target: 'library', title: '把决定和结果留在一起', text: '在决策库回看思考中的事、已确认的决定，并记录实际效果，完成复盘。' },
  { target: 'settings', title: '选择适合你的外观', text: '石墨银灰和蓝白在这里切换，也可以配置 AI、备份资料或记录改进建议。现在开始写下第一个问题吧。' },
];
type Box = { left: number; top: number; width: number; height: number };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

export default function GuidedTour({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [layout, setLayout] = useState<{ target: Box; card: Box; viewport: { width: number; height: number } } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), card = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = dialog.current!;
    el.showModal();
    return () => el.close();
  }, []);
  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>('[data-guide="' + steps[step].target + '"]');
    if (!target) return;
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const measure = () => {
      const rect = target.getBoundingClientRect();
      const width = window.innerWidth, height = window.innerHeight;
      const cw = Math.min(356, width - 32), ch = card.current?.offsetHeight || 250;
      const box = { left: Math.max(4, rect.left - 8), top: Math.max(4, rect.top - 8), width: rect.width + 16, height: rect.height + 16 };
      let x: number, y: number;
      if (rect.right + cw + 64 < width && rect.width < 180) {
        x = rect.right + 56;
        y = clamp(rect.top - 20, 16, height - ch - 16);
      } else {
        x = clamp(rect.left, 16, width - cw - 16);
        y = rect.bottom + ch + 64 < height ? rect.bottom + 52 : rect.top - ch - 52;
        y = clamp(y, 16, height - ch - 16);
      }
      setLayout({ target: box, card: { left: x, top: y, width: cw, height: ch }, viewport: { width, height } });
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (card.current) observer.observe(card.current);
    observer.observe(target);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [step]);
  let path = '';
  if (layout) {
    const t = layout.target, c = layout.card;
    const tx = t.left + t.width / 2, ty = t.top + t.height / 2;
    let sx = c.left + c.width / 2, sy = c.top + c.height / 2, ex = tx, ey = ty;
    if (c.left > t.left + t.width) { sx = c.left - 8; sy = clamp(ty, c.top + 24, c.top + c.height - 24); ex = t.left + t.width + 8; }
    else if (c.top > ty) { sy = c.top - 8; sx = clamp(tx, c.left + 24, c.left + c.width - 24); ey = t.top + t.height + 8; }
    else { sy = c.top + c.height + 8; sx = clamp(tx, c.left + 24, c.left + c.width - 24); ey = t.top - 8; }
    path = 'M ' + sx + ' ' + sy + ' Q ' + sx + ' ' + ey + ' ' + ex + ' ' + ey;
  }
  return <dialog ref={dialog} className="tour-root" aria-label="使用引导" onCancel={event => { event.preventDefault(); onClose(); }}>
    {layout && <svg className="tour-canvas" width={layout.viewport.width} height={layout.viewport.height} aria-hidden="true">
      <defs><mask id="tour-cutout"><rect width="100%" height="100%" fill="white" /><rect x={layout.target.left} y={layout.target.top} width={layout.target.width} height={layout.target.height} rx={steps[step].target === 'profile' ? 99 : 10} fill="black" /></mask><marker id="tour-arrowhead" markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></marker></defs>
      <rect width="100%" height="100%" fill="#101a2a" opacity=".58" mask="url(#tour-cutout)" />
      <rect className="tour-highlight" x={layout.target.left} y={layout.target.top} width={layout.target.width} height={layout.target.height} rx={steps[step].target === 'profile' ? 99 : 10} fill="none" stroke="white" strokeWidth="2" />
      <path className="tour-arrow" d={path} fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" markerEnd="url(#tour-arrowhead)" />
    </svg>}
    <div ref={card} className="tour-card" style={layout ? { left: layout.card.left, top: layout.card.top, width: layout.card.width } : { left: 16, top: 16, visibility: 'hidden' }}>
      <div className="tour-card-top"><span>使用引导 · {step + 1} / {steps.length}</span><button className="icon-button" aria-label="跳过引导" onClick={onClose}><X size={18} /></button></div>
      <h2>{steps[step].title}</h2><p>{steps[step].text}</p>
      <div className="tour-progress" aria-hidden="true">{steps.map((_, i) => <i key={i} className={i <= step ? 'done' : ''} />)}</div>
      <div className="tour-actions"><button className="text-button" onClick={onClose}>跳过</button><div>{step > 0 && <button className="secondary" onClick={() => setStep(v => v - 1)}>上一步</button>}<button className="primary" onClick={() => step === steps.length - 1 ? onClose() : setStep(v => v + 1)}>{step === steps.length - 1 ? '开始使用' : '下一步'}<ArrowRight size={14} /></button></div></div>
    </div>
  </dialog>;
}
