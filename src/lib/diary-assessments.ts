export type DiaryAssessmentSubItem = {
  id: string;
  name: string;
};

export type DiaryAssessmentSource = {
  id: string;
  name: string;
  max_score?: number | null;
  sub_items?: DiaryAssessmentSubItem[] | null;
};

export type DiaryAssessmentOption = {
  id: string;
  name: string;
  max_score: number;
};

function normalizeMaxScore(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 10;
}

export function flattenDiaryAssessmentOptions(
  assessments: DiaryAssessmentSource[] | null | undefined,
): DiaryAssessmentOption[] {
  const options: DiaryAssessmentOption[] = [];
  for (const assessment of assessments ?? []) {
    if (!assessment?.id || !assessment.name) continue;
    const maxScore = normalizeMaxScore(assessment.max_score);
    const subItems = Array.isArray(assessment.sub_items) ? assessment.sub_items : [];
    const validSubItems = subItems.filter((sub) => sub?.id && sub.name);

    if (validSubItems.length > 0) {
      for (const sub of validSubItems) {
        options.push({
          id: `${assessment.id}#${sub.id}`,
          name: `${assessment.name} — ${sub.name}`,
          max_score: maxScore,
        });
      }
    } else {
      options.push({ id: assessment.id, name: assessment.name, max_score: maxScore });
    }
  }
  return options;
}

export function extractDiaryAssessmentOptions(response: {
  diary_assessments?: DiaryAssessmentOption[] | null;
  assessments?: DiaryAssessmentSource[] | null;
}): DiaryAssessmentOption[] {
  const fromStructure = flattenDiaryAssessmentOptions(response.assessments);
  const fromServer = Array.isArray(response.diary_assessments)
    ? response.diary_assessments.filter((option) => option?.id && option.name)
    : [];

  // If the raw grade structure is present, it is the source of truth. This avoids
  // showing only parent columns when an older/server-cached summarized list is
  // present in `diary_assessments`.
  if (fromStructure.length > 0) return fromStructure;
  return fromServer;
}

export function isLaunchableDiaryAssessmentId(
  assessments: DiaryAssessmentSource[] | null | undefined,
  assessmentId: string,
): boolean {
  return flattenDiaryAssessmentOptions(assessments).some((option) => option.id === assessmentId);
}