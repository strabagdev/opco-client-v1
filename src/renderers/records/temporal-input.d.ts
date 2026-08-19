type TemporalFieldInputProps = {
  onChange(value: string): void;
  required: boolean;
  value: string;
};

export function DateFieldInput(props: TemporalFieldInputProps): JSX.Element;
export function TimeFieldInput(props: TemporalFieldInputProps): JSX.Element;
export function DateTimeFieldInput(props: TemporalFieldInputProps): JSX.Element;
