using Metraj.Application;
using Metraj.Domain;
using Metraj.Host;
using Metraj.Infrastructure;
using Xunit;

namespace Metraj.Tests;

/// <summary>
/// Rapor indirme adı: <c>{ProjeKodu}_R{RevizyonNo}[_{Kapsam}]_{yyyy-MM-dd_HHmm}.{uzantı}</c>.
/// Önceden GUID'li geçici dosya adı (metraj-&lt;guid&gt;-&lt;guid&gt;.pdf) kullanıcıya gösteriliyordu.
/// </summary>
public sealed class ReportFileNameTests
{
    private static readonly DateTime Moment = new(2026, 10, 17, 14, 5, 59, DateTimeKind.Local);

    [Fact]
    public void FullReportNameHasProjectRevisionAndMinuteResolutionTimestamp()
    {
        Assert.Equal("P-100_R2_2026-10-17_1405.pdf", ReportFileNames.Build("P-100", "R2", null, null, Moment, ".pdf"));
        Assert.Equal("P-100_R0_2026-10-17_1405.xlsx", ReportFileNames.Build("P-100", "R0", null, null, Moment, ".xlsx"));
    }

    [Fact]
    public void BareRevisionNumberGetsRPrefixAndMissingRevisionFallsBack()
    {
        Assert.Equal("P-100_R3_2026-10-17_1405.docx", ReportFileNames.Build("P-100", "3", null, null, Moment, ".docx"));
        Assert.Equal("P-100_R0_2026-10-17_1405.docx", ReportFileNames.Build("P-100", "  ", null, null, Moment, ".docx"));
    }

    [Fact]
    public void TurkishLettersSurviveSanitizing()
    {
        string name = ReportFileNames.Build("ŞİŞLİ-ÇAĞRI", "R1", "Zemin Kat Ğ-Ü-Ö Isıtma", null, Moment, ".pdf");

        Assert.Equal("ŞİŞLİ-ÇAĞRI_R1_Zemin-Kat-Ğ-Ü-Ö-Isıtma_2026-10-17_1405.pdf", name);
    }

    [Fact]
    public void FileSystemInvalidCharactersAndWhitespaceAreReplacedNotKept()
    {
        string name = ReportFileNames.Build("A/B\\C:D*E?F\"G<H>I|J", "R1", "Kat  1\t/\r\nBlok: A", null, Moment, ".pdf");

        Assert.Equal("A-B-C-D-E-F-G-H-I-J_R1_Kat-1-Blok-A_2026-10-17_1405.pdf", name);
        Assert.DoesNotContain(name, c => Path.GetInvalidFileNameChars().Contains(c));
    }

    [Fact]
    public void ControlAndInvisibleFormattingCharactersCannotSpoofTheExtension()
    {
        // U+202E (sağdan sola geçersiz kılma) "gpj.exe" gibi görünen adlar için kullanılır.
        string name = ReportFileNames.Build("PROJE‮gpj.exe\u0000", "R1", null, null, Moment, ".pdf");

        Assert.Equal("PROJEgpj.exe_R1_2026-10-17_1405.pdf", name);
        Assert.DoesNotContain(name, c => char.IsControl(c) || c == '‮');
    }

    [Fact]
    public void LeadingAndTrailingDotsAndSeparatorsAreTrimmed()
    {
        string name = ReportFileNames.Build("..__proje__..", "R1", " .. ", " - ", Moment, ".pdf");

        // Kapsam adı yalnız ayraçlardan oluşuyor: tam rapor gibi davranır.
        Assert.Equal("proje_R1_2026-10-17_1405.pdf", name);
    }

    [Fact]
    public void SubtreeNameCarriesScopeAndFallsBackFromNameToCode()
    {
        Assert.Equal("P-100_R1_Temiz-Su_2026-10-17_1405.pdf",
            ReportFileNames.Build("P-100", "R1", "TSU", "Temiz Su", Moment, ".pdf"));
        Assert.Equal("P-100_R1_TSU_2026-10-17_1405.pdf",
            ReportFileNames.Build("P-100", "R1", "TSU", "", Moment, ".pdf"));
        Assert.Equal("P-100_R1_TSU_2026-10-17_1405.pdf",
            ReportFileNames.Build("P-100", "R1", "TSU", null, Moment, ".pdf"));
    }

    [Fact]
    public void LongPartsAreCappedAndNeverSplitASurrogatePair()
    {
        string longProject = new('P', 300);
        string longScope = new string('K', 38) + "😀😀😀";

        string name = ReportFileNames.Build(longProject, "R1", null, longScope, Moment, ".xlsx");

        string[] parts = name.Split('_');
        Assert.Equal(ReportFileNames.MaxSegmentLength, parts[0].Length);
        Assert.True(name.Length <= 2 * ReportFileNames.MaxSegmentLength + 40, name);
        // 38 'K' + tek bir emoji (2 char) = 40; ikincisi yarım kalmaz, atılır.
        Assert.Equal(new string('K', 38) + "😀", parts[2]);
        Assert.EndsWith("_2026-10-17_1405.xlsx", name, StringComparison.Ordinal);
    }

    [Fact]
    public void LoneSurrogatesAreDroppedBecauseTheyAreInvalidInFileNames()
    {
        string name = ReportFileNames.Build("AB\uD800C", "R1", null, null, Moment, ".pdf");

        Assert.Equal("AB-C_R1_2026-10-17_1405.pdf", name);
    }

    [Fact]
    public void EmptyProjectCodeFallsBackToAGenericWord()
    {
        Assert.Equal("Proje_R1_2026-10-17_1405.pdf", ReportFileNames.Build(null, "R1", null, null, Moment, ".pdf"));
        Assert.Equal("Proje_R1_2026-10-17_1405.pdf", ReportFileNames.Build("///", "R1", null, null, Moment, ".pdf"));
    }

    [Fact]
    public void TimestampIsCultureIndependent()
    {
        var previous = System.Globalization.CultureInfo.CurrentCulture;
        try
        {
            System.Globalization.CultureInfo.CurrentCulture = new System.Globalization.CultureInfo("ar-SA");
            Assert.Equal("P_R1_2026-10-17_1405.pdf", ReportFileNames.Build("P", "R1", null, null, Moment, ".pdf"));
        }
        finally
        {
            System.Globalization.CultureInfo.CurrentCulture = previous;
        }
    }

    [Fact]
    public async Task RouterNamesFullAndSubtreeDownloadsFromTheStoredProjectRevisionAndRoot()
    {
        await using TestDatabase database = await TestDatabase.CreateAsync("metraj-report-file-names");
        ProjectListItem project = await new ProjectWorkspaceService(database.ContextFactory).CreateProjectAsync("Şişli/Blok:A", "Adlandırma");
        CatalogCardListItem card = await new CatalogWorkspaceService(database.ContextFactory).CreateCardAsync(new CatalogCardDraft(
            "PIPE-NAME", "Çelik boru", CardType.Material, ItemKind.Material, InputBehavior.Manual,
            SalesConversion.None, ReportBehavior.Measurable, "m"));
        PlacementListItem placement = await new ProjectTreeWorkspaceService(database.ContextFactory).AddPlacementAsync(
            new PlacementDraft(project.LatestRevisionId, card.LatestVersionId, DisplayNameOverride: "1. Kat: Kolon*"));
        await new MeasurementWorkspaceService(database.ContextFactory)
            .CreateMeasurementAsync(new MeasurementDraft(project.LatestRevisionId, placement.Id, 3m, "m"));
        using var services = MetrajServices.Create(database.Path);
        var router = new MetrajRequestRouter(services);

        string[] expectedStem = [];
        foreach ((string path, string extension, bool scoped) in new[]
        {
            ($"/api/revisions/{project.LatestRevisionId}/report/excel", ".xlsx", false),
            ($"/api/revisions/{project.LatestRevisionId}/report/pdf?placementId={placement.Id}", ".pdf", true),
            ($"/api/revisions/{project.LatestRevisionId}/report/subtree/{placement.Id}/word", ".docx", true)
        })
        {
            RouterResponse response = await router.DispatchAsync(new RouterRequest("GET", path, null, null, null), CancellationToken.None);
            RouterFile file = Assert.IsType<RouterFile>(response.File);
            try
            {
                string pattern = scoped
                    ? $"^ŞIŞLI-BLOK-A_R0_1\\.-Kat-Kolon_\\d{{4}}-\\d{{2}}-\\d{{2}}_\\d{{4}}\\{extension}$"
                    : $"^ŞIŞLI-BLOK-A_R0_\\d{{4}}-\\d{{2}}-\\d{{2}}_\\d{{4}}\\{extension}$";
                Assert.Matches(pattern, file.DownloadName);

                // Geçici yol GUID'li ve benzersiz: indirme adıyla aynı değil, iki istek birbirini ezmez.
                Assert.NotEqual(file.DownloadName, Path.GetFileName(file.Path));
                Assert.Matches("[0-9a-f]{32}", Path.GetFileName(file.Path));
                Assert.True(File.Exists(file.Path));
                expectedStem = [.. expectedStem, file.Path];
            }
            finally
            {
                File.Delete(file.Path);
            }
        }

        Assert.Equal(3, expectedStem.Distinct(StringComparer.OrdinalIgnoreCase).Count());
    }
}
