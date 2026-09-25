import unittest
from pathlib import Path
from unittest.mock import patch

from tools import export_model_summary as summary


def part(name, spec):
    return {"name_cn": name, "specification": spec, "quantity": "1", "search_text": ""}


class SummaryRefreshTests(unittest.TestCase):
    def test_capacitor_formats(self):
        cases = {
            "2.5uf-300V-(2.4-2.6)-OO級-BL規格": "2.5 µF 300V cấp OO",
            "RM101-4.5uf-(3.9-4.2)-W級-300V-BHM-黑": "4.5 µF 300V cấp W",
            "RM101-3.5uf-(3.3-3.5)-F級-350V-BL-黑": "3.5 µF 350V cấp F",
            "5線-4.0-300V-+4+5(3.7-3.9)-GG": "4.0 µF 300V 4+5 cấp GG",
            "4.5uf-350V+6+6-X級": "4.5 µF 350V 6+6 cấp X",
        }
        for spec, expected in cases.items():
            with self.subTest(spec=spec):
                self.assertEqual(summary.format_capacitor(spec), expected)

    def test_complete_old_summary_is_refreshed(self):
        old = {"customerModel": "F510L", "model": "RM192LED", "capacitor": "4.0 µF 300V cấp EE",
               "motor": "153*130*12", "motorLabel": "ImpedanceProtected-OO-2",
               "powerCord": "1010#18 - 30cm", "powerCordLabel": "1 tem , 2 ngôn ngữ"}
        bom = {"customerModel": "F510L", "model": "RM192LED", "path": Path("RM192LED(F510L).xlsx")}
        rows = [part("零件-電容器", "2.5uf-300V-(2.4-2.6)-OO級-BL規格")]
        with patch.object(summary, "bom_file_rows", return_value=[bom]), patch.object(summary, "load_index_rows", return_value=rows):
            result = summary.merge_rows([old], [old])[0]
        self.assertEqual(result["capacitor"], "2.5 µF 300V cấp OO")
        self.assertEqual(result["powerCord"], old["powerCord"])

    def test_reversing_module_precedes_receiver(self):
        rows = [part("零件-接收器", "R1A01-6+5uf-250V"),
                part("零件-正反轉模組", "RM101-4.5uf-(3.9-4.2)-W級-300V-BHM-黑")]
        with patch.object(summary, "load_index_rows", return_value=rows):
            self.assertEqual(summary.derive_row_fields({"customerModel": "F518L"}, {})["capacitor"], "4.5 µF 300V cấp W")

    def test_motor_dimensions_come_from_bom(self):
        rows = [part("粗胚-172x145x17", "YGRT001-矽鋼"),
                part("零件-馬達識別標", "Impedance-Protected-PP-UL")]
        with patch.object(summary, "load_index_rows", return_value=rows):
            derived = summary.derive_row_fields({"customerModel": "TMPH52"}, {"ImpedanceProtected-PP": "172*145*14"})
        self.assertEqual(derived["motor"], "172*145*17")
        self.assertNotIn("powerCord", derived)

    def test_motor_label_keeps_digits(self):
        self.assertEqual(summary.clean_motor_label("4x1CM-ImpedanceProtected-A1-3-UL"), "ImpedanceProtected-A1-3")

    def test_label_count_uses_named_labels(self):
        rows = [part("電源線組", "1010#18-235cm-4x2CM-MOTOR-英西法文-4x2CM-NEUTRAL-英西法文")]
        with patch.object(summary, "load_index_rows", return_value=rows):
            self.assertEqual(summary.derive_row_fields({}, {})["powerCordLabel"], "2 tem , 3 ngôn ngữ")

    def test_standalone_wire_labels_without_power_cord_assembly(self):
        rows = [part("零件-其他類標", "4x2CM-MOTOR-英西法文-黑底白字"),
                part("零件-其他類標", "4x2CM-NEUTRAL-英西法文-白底黑字"),
                part("零件-其他類標", "4.2x1.1CM-AMP-9P-#1色標"),
                part("粗胚-電線", "1010#18-36cm-12mm半-摩氏公端-黑"),
                part("粗胚-電線", "1010#18-45cm-10mm半-AMP公端-黑")]
        with patch.object(summary, "load_index_rows", return_value=rows):
            derived = summary.derive_row_fields({"customerModel": "TMPH52"}, {})
        self.assertEqual(derived["powerCordLabel"], "2 tem , 3 ngôn ngữ")
        self.assertNotIn("powerCord", derived)

    def test_assembly_label_count_takes_precedence(self):
        rows = [part("電源線組", "1010#18-235cm-MOTOR-NEUTRAL-LIGHT-英西法文"),
                part("零件-其他類標", "4x2CM-MOTOR-英西法文")]
        with patch.object(summary, "load_index_rows", return_value=rows):
            self.assertEqual(summary.derive_row_fields({}, {})["powerCordLabel"], "3 tem , 3 ngôn ngữ")

    def test_removed_bom_does_not_return_from_old_summary(self):
        with patch.object(summary, "bom_file_rows", return_value=[]):
            self.assertEqual(summary.merge_rows([{"customerModel": "OLD", "model": "old"}], []), [])


if __name__ == "__main__":
    unittest.main()
