import { FieldFrame } from "../../components/field-frame";
import { metrics, radii, space, typography } from "../../theme/tokens";
import { colors as palette } from "../../theme/paint";
import { focusStyle } from "../../theme/paint";
import { controlText, controlFrame } from "../../theme/control-presentation";
import { useFieldAccessibility } from "../../components/field-accessibility";
import { relationCardinalityIssue, relationKindIsAmbiguous } from "../../lib/relation-cardinality";
import { decimalPlaces } from "../../lib/decimal-precision";
import { useMemo, useState, type ReactNode } from "react";
import { Text, TextInput, Pressable, StyleSheet, View, Platform } from "react-native";

import { CompactSelect, activateCompactCheckboxFromKeyboard } from "../../components/compact-select";
import { EntityField } from "../../lib/opco-api";
import { isFieldUnsupported, isRelationFieldMultiple, RecordRelationOption } from "../../lib/record-form";

import { DateFieldInput, DateTimeFieldInput, TimeFieldInput } from "./temporal-input";

type FieldInputProps = {
  /** Form grouping is opt-in; legacy composition remains the default. */
  presentation?: "legacy" | "form";
  error?: string;
  field: EntityField;
  onBlur?(): void;
  onChange(value: string | boolean | string[]): void;
  onRelationSearch?(search: string): void;
  onRelationLoadMore?(): void;
  relationOptions?: RecordRelationOption[];
  relationOptionsError?: string | null;
  relationOptionsLoading?: boolean;
  relationTargetEntityTypeId?: string | null;
  value: string | boolean | string[] | undefined;
};

export function RecordFieldInput({
  presentation = "legacy",
  error,
  field,
  onBlur,
  onChange,
  onRelationSearch,
  onRelationLoadMore,
  relationOptions = [],
  relationOptionsError = null,
  relationOptionsLoading = false,
  relationTargetEntityTypeId = null,
  value,
}: FieldInputProps) {
  const a11y = useFieldAccessibility(field.name, error, field.required);
  const [focused, setFocused] = useState(false);
  if (isFieldUnsupported(field)) {
    return recordFieldFrame(presentation, field, a11y, undefined, (
      <>
        <Text style={styles.unsupported}>Este tipo de campo todavia no se puede editar: {field.type}.</Text>
      </>
    ));
  }

  if (field.type === "BOOLEAN") {
    const selected = value === true;

    return recordFieldFrame(presentation, field, a11y, error, (
      <>
        <Pressable
          {...a11y.controlProps} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}
          {...(Platform.OS === "web" ? { "aria-checked": selected, onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => activateCompactCheckboxFromKeyboard(event, false, () => onChange(!selected)) } : {})}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onPress={() => {
            onChange(!selected);
          }}
          style={[styles.optionButton, selected && styles.optionButtonSelected, presentation === "form" && formStyles.boolean, focused && styles.focus]}
        >
          {presentation === "form" ? <View accessible={false} style={[formStyles.check, selected && formStyles.checked]}><Text accessible={false} style={formStyles.checkMark}>{selected ? "✓" : ""}</Text></View> : null}
          <Text style={[styles.optionText, selected && styles.optionTextSelected, presentation === "form" && formStyles.booleanText]}>{selected ? "Sí" : "No"}</Text>
        </Pressable>
      </>
    ));
  }

  if (field.type === "SELECT" || field.type === "MULTISELECT") {
    const selectedValues = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
    const isMultiple = field.type === "MULTISELECT";

    return recordFieldFrame(presentation, field, a11y, error, (
      <>
        <CompactSelect {...a11y.accessibility} indicatorPlacement={presentation === "form" ? "end" : undefined} label={field.name} required={field.required} multiple={isMultiple}
          value={isMultiple ? selectedValues : selectedValues[0] ?? ""}
          options={[...(field.options ?? [])].sort((a, b) => a.order - b.order).map(option => ({ value: option.value, label: option.label, disabled: option.active === false }))}
          onChange={onChange} />
      </>
    ));
  }

  if (field.type === "RELATION") {
    return (
      <RelationFieldInput
        presentation={presentation}
        error={error}
        field={field}
        onChange={onChange}
        onSearch={onRelationSearch}
        onLoadMore={onRelationLoadMore}
        options={relationOptions}
        optionsError={relationOptionsError}
        optionsLoading={relationOptionsLoading}
        targetEntityTypeId={relationTargetEntityTypeId}
        value={value}
      />
    );
  }

  const textValue = Array.isArray(value) ? value.join(", ") : typeof value === "boolean" ? "" : value ?? "";

  if (field.type === "DATE" || field.type === "TIME" || field.type === "DATETIME") {
    return recordFieldFrame(presentation, field, a11y, error, (
      <>
        {field.type === "DATE" ? (
          <DateFieldInput {...a11y.accessibility} label={field.name} onChange={onChange} required={field.required} value={textValue} />
        ) : null}
        {field.type === "TIME" ? (
          <TimeFieldInput {...a11y.accessibility} label={field.name} onChange={onChange} required={field.required} value={textValue} />
        ) : null}
        {field.type === "DATETIME" ? (
          <DateTimeFieldInput {...a11y.accessibility} label={field.name} onChange={onChange} required={field.required} value={textValue} />
        ) : null}
      </>
    ));
  }

  const multiline = field.type === "TEXTAREA";

  return recordFieldFrame(presentation, field, a11y, error, (
      <>
      <TextInput
        {...a11y.controlProps}
        autoCapitalize="none"
        keyboardType={getKeyboardType(field.type)}
        multiline={multiline}
        onBlur={onBlur}
        onChangeText={(nextValue) => {
          onChange(nextValue);
        }}
        placeholder={getPlaceholder(field)}
        placeholderTextColor={palette.textQuiet}
        style={[styles.input, multiline && styles.textarea, presentation === "form" && formStyles.input, !!error && styles.invalid]}
        value={textValue}
      />
      {field.type === "DECIMAL" && decimalPlaces(field.config) !== undefined ? <Text style={styles.help}>Máximo {decimalPlaces(field.config)} decimales; sin redondeo automático.</Text> : null}
      </>
    ));
}

function RelationFieldInput({
  presentation,
  error,
  field,
  onChange,
  onSearch,
  onLoadMore,
  options,
  optionsError,
  optionsLoading,
  targetEntityTypeId,
  value,
}: {
  presentation: "legacy" | "form";
  error?: string;
  field: EntityField;
  onChange(value: string | boolean | string[]): void;
  onSearch?(search: string): void;
  onLoadMore?(): void;
  options: RecordRelationOption[];
  optionsError: string | null;
  optionsLoading: boolean;
  targetEntityTypeId: string | null;
  value: string | boolean | string[] | undefined;
}) {
  const a11y = useFieldAccessibility(field.name, error, field.required);
  const [search, setSearch] = useState("");
  const isMultiple = isRelationFieldMultiple(field);
  const cardinalityIssue = relationCardinalityIssue(field);
  const blockedCardinality = relationKindIsAmbiguous(field.config) || (!isMultiple && selectedRelationCount(value) > 1);
  const selectedValues = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
  const optionIds = useMemo(() => new Set(options.map((option) => option.id)), [options]);
  const unknownValues = selectedValues.filter((item) => !optionIds.has(item));
  const normalizedSearch = search.trim().toLocaleLowerCase("es-CL");
  const filteredOptions = useMemo(
    () =>
      normalizedSearch
        ? options.filter((option) =>
            option.displayName.toLocaleLowerCase("es-CL").includes(normalizedSearch) ||
            option.id.toLocaleLowerCase("es-CL").includes(normalizedSearch)
          )
        : options,
    [normalizedSearch, options],
  );

  return recordFieldFrame(presentation, field, a11y, error, (
      <>
      {targetEntityTypeId ? (
        <>
          {presentation === "form" ? <Text nativeID={`${a11y.labelId}-search`} style={formStyles.relationCaption}>Buscar opciones</Text> : null}
          <TextInput
            accessibilityLabel={`Buscar ${field.name}`}
            {...(presentation === "form" ? { "aria-labelledby": `${a11y.labelId} ${a11y.labelId}-search` } : {})}
            autoCapitalize="none"
            onChangeText={(value) => { setSearch(value); onSearch?.(value); }}
            placeholder="Buscar en catalogo"
            placeholderTextColor={palette.textQuiet}
            style={[styles.input, presentation === "form" && formStyles.input, !!error && styles.invalid]}
            value={search}
          />
          {optionsLoading ? <Text style={styles.help}>Cargando catalogo...</Text> : null}
          {optionsError ? <Text style={styles.fieldError}>{optionsError}</Text> : null}
          {unknownValues.length > 0 ? (
            <Text style={styles.fieldError}>
              El valor guardado no corresponde a un registro disponible del catalogo. Selecciona un registro valido para conservar el cambio y reintentar.
            </Text>
          ) : null}
          {!optionsLoading && !optionsError && options.length === 0 ? (
            <Text style={styles.fieldError}>No hay registros disponibles en el catalogo para seleccionar.</Text>
          ) : null}
          {cardinalityIssue || blockedCardinality ? <Text accessibilityRole="alert" style={styles.fieldError}>{cardinalityIssue ?? "Este campo conserva varias relaciones y requiere revisión antes de guardar."}</Text> : null}
          {blockedCardinality && selectedValues.length > 1 ? <Text style={styles.help}>{selectedValues.map(id => options.find(option => option.id === id)?.displayName ?? "Selección no disponible").join(", ")}</Text> : null}
          {presentation === "form" ? <Text nativeID={`${a11y.labelId}-selection`} style={formStyles.relationCaption}>Selección actual</Text> : null}
          <CompactSelect {...a11y.accessibility} indicatorPlacement={presentation === "form" ? "end" : undefined}
            labelledBy={presentation === "form" ? `${a11y.labelId} ${a11y.labelId}-selection` : a11y.accessibility.labelledBy}
            label={field.name} required={field.required} multiple={isMultiple} disabled={blockedCardinality}
            value={isMultiple ? selectedValues : selectedValues[0] ?? ""}
            options={[...filteredOptions, ...options.filter(option => selectedValues.includes(option.id) && !filteredOptions.some(filtered => filtered.id === option.id))].map(option => ({ value: option.id, label: option.displayName }))}
            onChange={onChange} />
          {onLoadMore ? <Pressable accessibilityRole="button" disabled={optionsLoading} onPress={onLoadMore} style={[styles.clearButton, optionsLoading && styles.disabled]}><Text style={[styles.clearButtonText, optionsLoading && styles.disabledText]}>Más opciones</Text></Pressable> : null}
        </>
      ) : (
        <Text style={styles.fieldError}>Este campo de relacion no tiene un catalogo configurado.</Text>
      )}
      </>
    ));
}

/** Pure composition helper, never a component declared inside render. */
function recordFieldFrame(presentation: "legacy" | "form", field: EntityField, a11y: ReturnType<typeof useFieldAccessibility>, error: string | undefined, children: ReactNode) {
  if (presentation === "form") return <FieldFrame label={field.name} labelId={a11y.labelId} required={field.required} errorId={a11y.errorId} error={error}>{children}</FieldFrame>;
  return <View style={styles.fieldGroup}>
    <Text nativeID={a11y.labelId} style={styles.label}>{field.name}{field.required ? " (obligatorio)" : ""}</Text>
    {children}
    <FieldError id={a11y.errorId} error={error} />
  </View>;
}

function selectedRelationCount(value: FieldInputProps["value"]) { return Array.isArray(value) ? value.length : value ? 1 : 0; }

function FieldError({ error, id }: { error?: string; id: string }) {
  return error ? <Text nativeID={id} accessibilityRole="alert" style={styles.fieldError}>{error}</Text> : null;
}

function getKeyboardType(fieldType: EntityField["type"]) {
  if (fieldType === "INTEGER" || fieldType === "DECIMAL" || fieldType === "MONEY") {
    return "numeric";
  }

  return "default";
}

function getPlaceholder(field: EntityField) {
  if (field.type === "RELATION" && field.multiple) {
    return "ids separados por coma";
  }

  return field.required ? "Obligatorio" : "";
}

const styles = StyleSheet.create({
  focus: focusStyle,
  invalid: { borderColor: palette.danger },
  fieldError: { color: palette.danger, ...typography.table, minHeight: typography.table.lineHeight },
  clearButton: { ...controlFrame, alignSelf: "flex-start", justifyContent: "center", borderColor: palette.controlBorder, backgroundColor: palette.surface, paddingVertical: space.sm },
  clearButtonText: { color: palette.onSecondary, ...typography.label },
  disabled: { backgroundColor: palette.disabled, borderColor: palette.disabledBorder }, disabledText: { color: palette.onDisabled },
  fieldGroup: { backgroundColor: palette.surface, borderColor: palette.border, borderRadius: radii.control, borderWidth: 1, gap: space.sm, padding: space.md },
  help: { color: palette.textSecondary, ...typography.table },
  input: { ...controlFrame, ...controlText, borderColor: palette.controlBorder, color: palette.text, backgroundColor: palette.surface },
  label: { color: palette.text, ...typography.label },
  optionButton: { ...controlFrame, borderColor: palette.controlBorder, backgroundColor: palette.surface, paddingVertical: space.sm },
  optionButtonSelected: { backgroundColor: palette.primary, borderColor: palette.primary },
  optionList: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  optionText: { color: palette.text, ...typography.control },
  optionTextSelected: { color: palette.onPrimary },
  textarea: { minHeight: 110, paddingTop: space.md, textAlignVertical: "top" },
  unsupported: { color: palette.textSecondary, ...typography.table },
});
const formStyles = StyleSheet.create({
  relationCaption: { color: palette.textSecondary, ...typography.meta, fontWeight: "600" },
  input: { minWidth: 0, maxWidth: "100%" },
  boolean: { flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: metrics.controlMinHeight, backgroundColor: palette.surface, borderColor: palette.controlBorder },
  booleanText: { color: palette.text, fontWeight: "400" },
  check: { width: metrics.iconNavigation, height: metrics.iconNavigation, borderRadius: radii.badge, borderWidth: 1, borderColor: palette.controlBorder, alignItems: "center", justifyContent: "center" },
  checked: { backgroundColor: palette.primary, borderColor: palette.primary },
  checkMark: { color: palette.onPrimary, ...typography.control },
});
