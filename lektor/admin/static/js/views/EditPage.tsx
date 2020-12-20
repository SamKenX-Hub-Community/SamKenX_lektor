import React, { createRef, FormEvent, RefObject } from "react";
import { Prompt } from "react-router-dom";

import RecordComponent, { RecordProps } from "../components/RecordComponent";
import { isMetaKey } from "../utils";
import { loadData } from "../fetch";
import { trans } from "../i18n";
import {
  getWidgetComponentWithFallback,
  FieldBox,
  FieldRows,
} from "../widgets";
import { bringUpDialog } from "../richPromise";
import { Field } from "../widgets/types";

type State = {
  recordData: null;
  recordDataModel: null;
  recordInfo: null;
  hasPendingChanges: boolean;
};

class EditPage extends RecordComponent<unknown, State> {
  form: RefObject<HTMLFormElement>;

  constructor(props: RecordProps) {
    super(props);

    this.state = {
      recordData: null,
      recordDataModel: null,
      recordInfo: null,
      hasPendingChanges: false,
    };
    this.onKeyPress = this.onKeyPress.bind(this);
    this.setFieldValue = this.setFieldValue.bind(this);
    this.form = createRef();
  }

  componentDidMount() {
    this.syncEditor();
    window.addEventListener("keydown", this.onKeyPress);
  }

  componentDidUpdate(prevProps: RecordProps) {
    if (prevProps.match.params.path !== this.props.match.params.path) {
      this.syncEditor();
    }
  }

  componentWillUnmount() {
    window.removeEventListener("keydown", this.onKeyPress);
  }

  onKeyPress(event: KeyboardEvent) {
    // Command+s/Ctrl+s to save
    if (event.key === "s" && isMetaKey(event)) {
      event.preventDefault();
      const form = this.form.current;
      if (form && form.reportValidity()) {
        this.saveChanges();
      }
    }
  }

  isIllegalField(field: Field) {
    switch (field.name) {
      case "_id":
      case "_path":
      case "_gid":
      case "_alt":
      case "_source_alt":
      case "_model":
      case "_attachment_for":
        return true;
      case "_attachment_type":
        return !this.state.recordInfo.is_attachment;
    }
    return false;
  }

  syncEditor() {
    loadData("/rawrecord", {
      path: this.getRecordPath(),
      alt: this.getRecordAlt(),
    }).then((resp) => {
      // transform resp.data into actual data
      const recordData = {};
      resp.datamodel.fields.forEach((field) => {
        const widget = getWidgetComponentWithFallback(field.type);
        let value = resp.data[field.name];
        if (value !== undefined) {
          if (widget.deserializeValue) {
            value = widget.deserializeValue(value, field.type);
          }
          recordData[field.name] = value;
        }
      });
      this.setState({
        recordData,
        recordDataModel: resp.datamodel,
        recordInfo: resp.record_info,
        hasPendingChanges: false,
      });
    }),
      bringUpDialog;
  }

  setFieldValue(field, value, uiChange = false) {
    const rd = { ...this.state.recordData, [field.name]: value || "" };
    this.setState({
      recordData: rd,
      hasPendingChanges: !uiChange,
    });
  }

  getValues() {
    const rv = {};
    this.state.recordDataModel.fields.forEach((field) => {
      if (this.isIllegalField(field)) {
        return;
      }

      let value = this.state.recordData[field.name];

      if (value !== undefined) {
        const Widget = getWidgetComponentWithFallback(field.type);
        if (Widget.serializeValue) {
          value = Widget.serializeValue(value, field.type);
        }
      } else {
        value = null;
      }

      rv[field.name] = value;
    });

    return rv;
  }

  saveChanges(event?: FormEvent) {
    if (event) {
      event.preventDefault();
    }

    const path = this.getRecordPath();
    const alt = this.getRecordAlt();
    const newData = this.getValues();
    loadData("/rawrecord", null, {
      json: { data: newData, path: path, alt: alt },
      method: "PUT",
    }).then(() => {
      this.setState(
        {
          hasPendingChanges: false,
        },
        () => {
          this.transitionToAdminPage(
            "preview",
            this.getUrlRecordPathWithAlt(path)
          );
        }
      );
    }, bringUpDialog);
  }

  deleteRecord() {
    this.transitionToAdminPage("delete", this.getUrlRecordPathWithAlt());
  }

  getValueForField(widget, field) {
    let value = this.state.recordData[field.name];
    if (value === undefined) {
      value = "";
      if (widget.deserializeValue) {
        value = widget.deserializeValue(value, field.type);
      }
    }
    return value;
  }

  getPlaceholderForField(widget, field) {
    if (field.default !== null) {
      if (widget.deserializeValue) {
        return widget.deserializeValue(field.default, field.type);
      }
      return field.default;
    } else if (field.name === "_slug") {
      return this.state.recordInfo.slug_format;
    } else if (field.name === "_template") {
      return this.state.recordInfo.default_template;
    } else if (field.name === "_attachment_type") {
      return this.state.recordInfo.implied_attachment_type;
    }
    return null;
  }

  renderFormField(field) {
    const Widget = getWidgetComponentWithFallback(field.type);
    return (
      <FieldBox
        key={field.name}
        value={this.getValueForField(Widget, field)}
        placeholder={this.getPlaceholderForField(Widget, field)}
        field={field}
        setFieldValue={this.setFieldValue}
        disabled={
          !(
            field.alts_enabled == null ||
            field.alts_enabled ^ (this.state.recordInfo.alt === "_primary")
          )
        }
      />
    );
  }

  render() {
    // we have not loaded anything yet.
    if (this.state.recordInfo === null) {
      return null;
    }

    const deleteButton = this.state.recordInfo.can_be_deleted ? (
      <button
        type="button"
        className="btn btn-default"
        onClick={this.deleteRecord.bind(this)}
      >
        {trans("DELETE")}
      </button>
    ) : null;

    const title = this.state.recordInfo.is_attachment
      ? trans("EDIT_ATTACHMENT_METADATA_OF")
      : trans("EDIT_PAGE_NAME");

    const label = this.state.recordInfo.label_i18n
      ? trans(this.state.recordInfo.label_i18n)
      : this.state.recordInfo.label;

    const fields = this.state.recordDataModel.fields.filter(
      (f) => !this.isIllegalField(f)
    );
    return (
      <div className="edit-area">
        {this.state.hasPendingChanges && (
          <Prompt message={() => trans("UNLOAD_ACTIVE_TAB")} />
        )}
        <h2>{title.replace("%s", label)}</h2>
        <form ref={this.form} onSubmit={this.saveChanges.bind(this)}>
          <FieldRows
            fields={fields}
            renderFunc={this.renderFormField.bind(this)}
          />
          <div className="actions">
            <button type="submit" className="btn btn-primary">
              {trans("SAVE_CHANGES")}
            </button>
            {deleteButton}
          </div>
        </form>
      </div>
    );
  }
}

export default EditPage;
