import { AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { Backdrop } from "../components/Backdrop";
import { AppWindow } from "../components/AppWindow";
import { MockForm, type Field } from "../components/MockForm";
import { MockPreview, type PreviewKind } from "../components/MockPreview";
import { COLORS } from "../theme";

export const CreatorShowcase: React.FC<{
  display: string;
  body: string;
  badge: string;
  headline: string;
  sub: string;
  accent: string;
  fields: Field[];
  cta: string;
  kind: PreviewKind;
  previewTitle: string;
}> = ({ display, badge, headline, sub, accent, fields, cta, kind, previewTitle }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = spring({ frame: frame - 4, fps, config: { damping: 20, stiffness: 150 } });
  const float = Math.sin(frame / 34) * 5;
  const previewStart = 12 + fields.length * 22 + 34;

  return (
    <AbsoluteFill>
      <Backdrop />
      <AbsoluteFill style={{ padding: "48px 70px 40px", flexDirection: "column" }}>
        <div style={{ opacity: t, transform: `translateY(${(1 - t) * 22}px)` }}>
          <div
            style={{
              fontSize: 19,
              letterSpacing: 4,
              fontWeight: 800,
              color: accent,
              marginBottom: 6,
            }}
          >
            {badge}
          </div>
          <div
            style={{
              fontFamily: display,
              fontSize: 48,
              fontWeight: 700,
              color: "#fff",
              lineHeight: 1.05,
            }}
          >
            {headline}
          </div>
          <div style={{ fontSize: 22, color: COLORS.muted, marginTop: 6 }}>{sub}</div>
        </div>

        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: `translateY(${float}px)`,
          }}
        >
          <AppWindow moduleName={badge} accent={accent} display={display} delay={6}>
            <MockForm fields={fields} accent={accent} cta={cta} display={display} />
            <MockPreview
              kind={kind}
              accent={accent}
              display={display}
              start={previewStart}
              title={previewTitle}
            />
          </AppWindow>
        </div>
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background: `linear-gradient(to top, rgba(8,20,46,${interpolate(
            frame,
            [0, 20],
            [0.45, 0],
            { extrapolateRight: "clamp" },
          )}), transparent)`,
        }}
      />
    </AbsoluteFill>
  );
};