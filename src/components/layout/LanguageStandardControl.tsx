import { ChevronDown } from "lucide-react";
import { DropdownMenu } from "radix-ui";

import {
  C_STANDARDS,
  CPP_STANDARDS,
  isLanguageStandardForLanguage,
  languageStandardLabel,
  type LanguageStandard,
  type SourceLanguage,
} from "../../languages.js";
import { MenuRadioItem, menuContentClass } from "../ui/Menu.js";

interface LanguageStandardControlProps {
  language?: SourceLanguage;
  standard?: LanguageStandard;
  disabled?: boolean;
  onChange: (standard: LanguageStandard) => void;
}

export function LanguageStandardControl({
  language,
  standard,
  disabled = false,
  onChange,
}: LanguageStandardControlProps) {
  const standards: readonly LanguageStandard[] = language === "cpp"
    ? CPP_STANDARDS
    : language === "c"
      ? C_STANDARDS
      : [];
  const label = standard ? languageStandardLabel(standard) : "文本";

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label="选择语言标准"
          disabled={disabled || !language || !standard}
          className="flex h-8 min-w-[72px] cursor-pointer items-center justify-center gap-1.5 rounded-md border border-white/[0.12] bg-white/[0.045] px-2.5 text-[11px] font-semibold text-neutral-200 outline-none transition hover:bg-white/[0.09] focus-visible:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <span>{label}</span>
          <ChevronDown className="size-3" strokeWidth={2} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={5}
          className={menuContentClass}
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-[10px] font-semibold tracking-[0.08em] text-neutral-400 uppercase">
            {language === "cpp" ? "C++ 语言标准" : "C 语言标准"}
          </DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={standard}
            onValueChange={(value) => {
              if (language && isLanguageStandardForLanguage(language, value)) onChange(value);
            }}
          >
            {standards.map((option) => (
              <MenuRadioItem key={option} value={option}>
                <span className="flex-1">{languageStandardLabel(option)}</span>
                {option === "c++26" && (
                  <span className="text-[10px] text-neutral-400">实验性</span>
                )}
              </MenuRadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
