// The print reports (spec §7: report routes have their own stylesheet). The app's chrome is left out
// of them by ShellGate; this layout only brings the stylesheet: letter pages with 18 mm margins and
// numbered pages, the light palette forced, and tables fitted to the page.
import './report.css';

export default function ReportLayout({ children }: LayoutProps<'/report'>) {
  return children;
}
