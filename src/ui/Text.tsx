/**
 * The app's text. Every screen takes Text and TextInput from here; fonts.ts says
 * why, and fonts.test.ts holds them to it.
 */

import { Children, type ReactNode } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { notoBeside, resolveFont, scriptRuns } from './fonts';

/** The style with its font worked out, for text that cannot come through `Text`. */
export function textStyle(style: StyleProp<TextStyle>) {
  return resolveFont(StyleSheet.flatten(style) ?? {});
}

function withChineseSetApart(children: ReactNode, noto: string): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child !== 'string') return child;

    const runs = scriptRuns(child);
    if (!runs.some((run) => run.chinese)) return child;

    return runs.map((run, index) =>
      run.chinese ? (
        <NativeText key={index} style={{ fontFamily: noto }}>
          {run.text}
        </NativeText>
      ) : (
        run.text
      ),
    );
  });
}

export function Text({ style, children, ...rest }: TextProps) {
  const resolved = textStyle(style);
  const noto = notoBeside(resolved.fontFamily);

  return (
    <NativeText {...rest} style={resolved}>
      {noto ? withChineseSetApart(children, noto) : children}
    </NativeText>
  );
}

export function TextInput({ style, ...rest }: TextInputProps) {
  return <NativeTextInput {...rest} style={textStyle(style)} />;
}
